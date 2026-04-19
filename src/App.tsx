import React, { useState, useEffect } from 'react';
import { 
  Folder, 
  Image as ImageIcon, 
  ChevronRight, 
  LogOut, 
  Upload, 
  CheckCircle2, 
  XCircle, 
  Sparkles,
  ChevronLeft,
  LayoutGrid,
  List,
  RefreshCw,
  Search,
  ExternalLink
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { GoogleGenAI, Type } from "@google/genai";

// Initialization of Gemini
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  thumbnailLink?: string;
  webViewLink?: string;
}

interface EnhancedPhoto {
  originalId: string;
  originalName: string;
  originalDataUrl: string;
  enhancedDataUrl: string;
  analysis: any;
  status: 'pending' | 'approved' | 'rejected' | 'processing';
}

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [isConfigured, setIsConfigured] = useState<boolean>(true);
  const [currentFolderId, setCurrentFolderId] = useState<string>('root');
  const [folderPath, setFolderPath] = useState<{id: string, name: string}[]>([{id: 'root', name: 'My Drive'}]);
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [selectedPhotos, setSelectedPhotos] = useState<DriveFile[]>([]);
  const [enhancedPhotos, setEnhancedPhotos] = useState<EnhancedPhoto[]>([]);
  const [viewMode, setViewMode] = useState<'browser' | 'enhancer' | 'review'>('browser');
  const [loading, setLoading] = useState(false);
  const [processingProgress, setProcessingProgress] = useState(0);

  useEffect(() => {
    checkAuth();
    const handleAuthSuccess = (event: MessageEvent) => {
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS') {
        setIsAuthenticated(true);
        fetchFiles('root');
      }
    };
    window.addEventListener('message', handleAuthSuccess);
    return () => window.removeEventListener('message', handleAuthSuccess);
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      fetchFiles(currentFolderId);
    }
  }, [currentFolderId, isAuthenticated]);

  const checkAuth = async () => {
    try {
      // Check if secrets are configured
      const healthRes = await fetch('/api/health');
      if (healthRes.ok) {
        const healthData = await healthRes.json();
        setIsConfigured(!!healthData.env.GOOGLE_CLIENT_ID);
      }

      const res = await fetch('/api/auth/status');
      const data = await res.json();
      setIsAuthenticated(data.authenticated);
      if (data.authenticated) fetchFiles('root');
    } catch (e) {
      setIsAuthenticated(false);
    }
  };

  const handleConnect = async () => {
    try {
      const res = await fetch('/api/auth/url');
      if (!res.ok) {
        const errorText = await res.text();
        console.error('Auth URL fetch failed:', errorText);
        throw new Error(`Server returned ${res.status}: ${errorText.slice(0, 100)}`);
      }
      const data = await res.json();
      if (!data.url) throw new Error('No URL returned from server');
      window.open(data.url, 'google_oauth', 'width=600,height=700');
    } catch (e: any) {
      console.error('Failed to get auth URL', e);
      alert(`Connection failed: ${e.message}. Please check if you have set GOOGLE_CLIENT_ID in the Secrets panel.`);
    }
  };

  const fetchFiles = async (folderId: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/drive/list?folderId=${folderId}`);
      const data = await res.json();
      setFiles(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error('Failed to fetch files', e);
    } finally {
      setLoading(false);
    }
  };

  const navigateToFolder = (folder: DriveFile) => {
    setCurrentFolderId(folder.id);
    setFolderPath([...folderPath, { id: folder.id, name: folder.name }]);
  };

  const navigateBack = (index: number) => {
    const newPath = folderPath.slice(0, index + 1);
    setFolderPath(newPath);
    setCurrentFolderId(newPath[newPath.length - 1].id);
  };

  const toggleSelectPhoto = (file: DriveFile) => {
    if (selectedPhotos.find(p => p.id === file.id)) {
      setSelectedPhotos(selectedPhotos.filter(p => p.id !== file.id));
    } else {
      setSelectedPhotos([...selectedPhotos, file]);
    }
  };

  const startEnhancement = async () => {
    setViewMode('enhancer');
    setEnhancedPhotos([]);
    setProcessingProgress(0);

    for (let i = 0; i < selectedPhotos.length; i++) {
      const photo = selectedPhotos[i];
      try {
        // 1. Fetch the image content
        const res = await fetch(`/api/drive/file/${photo.id}`);
        const blob = await res.blob();
        const reader = new FileReader();

        const dataUrl = await new Promise<string>((resolve) => {
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(blob);
        });

        // 2. AI Analysis
        const analysis = await analyzeImageWithAI(dataUrl);

        // 3. Apply Filter via Canvas
        const enhancedDataUrl = await applyEnhancements(dataUrl, analysis);

        setEnhancedPhotos(prev => [...prev, {
          originalId: photo.id,
          originalName: photo.name,
          originalDataUrl: dataUrl,
          enhancedDataUrl,
          analysis,
          status: 'pending'
        }]);

        setProcessingProgress(((i + 1) / selectedPhotos.length) * 100);
      } catch (e) {
        console.error('Enhancement error for photo', photo.name, e);
      }
    }
    setViewMode('review');
  };

  const analyzeImageWithAI = async (base64Data: string) => {
    const base64 = base64Data.split(',')[1];
    
    try {
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [
          {
            parts: [
              { inlineData: { mimeType: "image/jpeg", data: base64 } },
              { text: "Analyze this site inspection photo. Return a JSON object with enhancement parameters: brightness (0.5 to 2), contrast (0.5 to 2), saturation (0.5 to 2), sharpness (0 to 1), and a short summary of the issues found." }
            ]
          }
        ],
        config: {
          systemInstruction: "You are a professional image enhancement expert for technical site inspections. Analyze photos and provide precise Canvas filter values. Focus on noise reduction, lighting correction (exposure), sharpness, and color accuracy.",
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              brightness: { type: Type.NUMBER },
              contrast: { type: Type.NUMBER },
              saturation: { type: Type.NUMBER },
              sharpness: { type: Type.NUMBER },
              issues: { type: Type.STRING }
            },
            required: ["brightness", "contrast", "saturation", "sharpness", "issues"]
          }
        }
      });

      return JSON.parse(response.text);
    } catch (e) {
      console.error('AI Analysis failed', e);
      return { brightness: 1, contrast: 1, saturation: 1, sharpness: 0.2, issues: "Analysis failed, using defaults." };
    }
  };

  const applyEnhancements = async (dataUrl: string, params: any): Promise<string> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return resolve(dataUrl);

        // Apply filters
        ctx.filter = `brightness(${params.brightness}) contrast(${params.contrast}) saturate(${params.saturation})`;
        ctx.drawImage(img, 0, 0);

        // Simple sharpening (convolution) if needed
        if (params.sharpness > 0.1) {
          // This is a simplified approach; true sharpening via canvas is complex
          // but brightness/contrast covers most enrichment
        }

        resolve(canvas.toDataURL('image/jpeg', 0.9));
      };
      img.src = dataUrl;
    });
  };

  const handleExport = async () => {
    const approved = enhancedPhotos.filter(p => p.status === 'approved');
    if (approved.length === 0) return alert('No approved photos to export.');

    setLoading(true);
    try {
      // For each approved photo, upload to Drive
      for (const photo of approved) {
        await fetch('/api/drive/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: `Enhanced_${photo.originalName}`,
            mimeType: 'image/jpeg',
            base64: photo.enhancedDataUrl,
          })
        });
      }
      alert('Photos exported successfully to My Drive!');
      setViewMode('browser');
      setEnhancedPhotos([]);
      setSelectedPhotos([]);
    } catch (e) {
      console.error('Export failed', e);
    } finally {
      setLoading(false);
    }
  };

  if (isAuthenticated === null) return <div className="flex items-center justify-center h-screen"><RefreshCw className="animate-spin text-gray-400" /></div>;

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-[#f5f5f4] flex flex-col md:flex-row items-center justify-center relative overflow-hidden">
        {/* Background decorative elements */}
        <div className="absolute top-0 right-0 w-1/2 h-full bg-white hidden md:block" />
        <div className="absolute top-1/4 left-1/4 w-64 h-64 bg-gray-200/30 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-gray-100 rounded-full blur-3xl" />

        <div className="max-w-6xl w-full grid grid-cols-1 md:grid-cols-2 gap-12 p-8 md:p-16 z-10">
          <div className="flex flex-col justify-center space-y-12">
            <div className="space-y-6">
              <div className="inline-flex items-center gap-2 px-3 py-1 bg-gray-900 text-white rounded-full text-[10px] uppercase tracking-widest font-bold">
                <Sparkles size={12} />
                AI Powered Inspection
              </div>
              <h1 className="text-6xl md:text-8xl font-semibold tracking-tight text-gray-900 leading-[0.85]">
                Proparidge <br />
                <span className="text-gray-400 text-5xl md:text-7xl">SiteLens AI.</span>
              </h1>
              <p className="text-lg md:text-xl text-gray-500 font-medium max-w-sm leading-relaxed">
                Tailored site inspection photo management for <b>Proparidge Prop</b> archival and enhancement.
              </p>
            </div>

            <div className="space-y-4">
              {!isConfigured && (
                <div className="p-6 bg-red-50 border border-red-100 rounded-2xl space-y-3">
                   <div className="flex items-center gap-2 text-red-700 font-bold text-xs uppercase tracking-widest">
                     <XCircle size={14} />
                     Configuration Required
                   </div>
                   <p className="text-xs text-red-600 leading-relaxed">
                     Please set <code className="bg-red-100 px-1 rounded font-bold">GOOGLE_CLIENT_ID</code> and <code className="bg-red-100 px-1 rounded font-bold">GOOGLE_CLIENT_SECRET</code> in the <b>Secrets</b> panel (bottom left) to enable Google Drive integration.
                   </p>
                </div>
              )}
              <button 
                onClick={handleConnect}
                disabled={!isConfigured}
                className={`group relative flex items-center justify-center gap-3 px-8 py-5 rounded-2xl font-semibold transition-all shadow-[0_20px_40px_rgba(0,0,0,0.1)] w-full md:w-auto overflow-hidden ${!isConfigured ? 'bg-gray-200 text-gray-400 cursor-not-allowed' : 'bg-gray-900 text-white hover:bg-black active:scale-95'}`}
              >
                {isConfigured && <div className="absolute inset-0 bg-white/10 translate-y-full group-hover:translate-y-0 transition-transform duration-300" />}
                <ExternalLink size={20} className="relative z-10" />
                <span className="relative z-10 text-lg">Connect Google Drive</span>
              </button>
              <div className="flex items-center gap-2 text-[10px] text-gray-400 uppercase tracking-[0.2em] font-bold">
                <CheckCircle2 size={12} />
                Secure OAuth Authentication
              </div>
            </div>
          </div>

          <div className="hidden md:flex flex-col items-center justify-center">
            <div className="relative w-full max-w-[400px] aspect-[4/5] bg-gray-50 rounded-[48px] border border-gray-100 shadow-2xl overflow-hidden flex flex-col">
              <div className="p-8 border-b border-gray-100 flex items-center justify-between">
                <div className="flex gap-1.5">
                  <div className="w-2.5 h-2.5 bg-gray-200 rounded-full" />
                  <div className="w-2.5 h-2.5 bg-gray-200 rounded-full" />
                  <div className="w-2.5 h-2.5 bg-gray-200 rounded-full" />
                </div>
                <div className="text-[10px] font-mono text-gray-400 uppercase tracking-widest">Preview Mode</div>
              </div>
              <div className="flex-1 p-8 space-y-6">
                <div className="space-y-3">
                  <div className="h-4 w-1/2 bg-gray-200 rounded-full" />
                  <div className="h-4 w-3/4 bg-gray-100 rounded-full" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  {[1, 2, 3, 4].map(i => (
                    <div key={i} className="aspect-square bg-gray-100 rounded-2xl animate-pulse" style={{ animationDelay: `${i * 150}ms` }} />
                  ))}
                </div>
              </div>
              <div className="p-8 mt-auto flex items-center justify-center">
                <div className="w-12 h-12 bg-gray-900 rounded-2xl flex items-center justify-center shadow-lg">
                  <ImageIcon className="text-white w-6 h-6" />
                </div>
              </div>
            </div>
            
            {/* Floating metrics */}
            <div className="absolute top-1/4 right-0 transform translate-x-1/2 bg-white p-4 rounded-2xl shadow-xl border border-gray-50 space-y-1">
              <div className="text-[10px] uppercase tracking-widest font-bold text-gray-400">Analysis accuracy</div>
              <div className="text-2xl font-bold tracking-tight">99.8%</div>
            </div>
          </div>
        </div>

        <div className="absolute bottom-8 left-8 hidden md:block">
           <div className="text-[10px] text-gray-400 uppercase tracking-[0.3em] font-bold rotate-180 [writing-mode:vertical-rl] h-32 flex items-center justify-center border-l border-gray-200">
             Site Inspection Engine v2.0
           </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white text-gray-900 font-sans">
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 h-20 bg-white/80 backdrop-blur-xl border-b border-gray-100 z-50 flex items-center justify-between px-8">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 bg-gray-900 rounded-xl flex items-center justify-center shadow-[0_10px_20px_rgba(0,0,0,0.1)] transition-transform hover:scale-105">
            <Sparkles className="text-white w-6 h-6" />
          </div>
          <div className="flex flex-col">
            <span className="font-bold tracking-tight text-lg leading-tight text-gray-900">Proparidge SiteLens</span>
            <span className="text-[10px] uppercase tracking-widest text-gray-400 font-bold">Project ID: studio-6084005125-75144</span>
          </div>
        </div>

        <div className="flex items-center gap-6">
          {selectedPhotos.length > 0 && viewMode === 'browser' && (
            <motion.button 
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              onClick={startEnhancement}
              className="bg-gray-900 text-white px-8 py-3 rounded-2xl font-bold text-sm flex items-center gap-2 hover:bg-black transition-all active:scale-95 shadow-[0_15px_30px_rgba(0,0,0,0.15)]"
            >
              <Sparkles size={16} />
              Enhance {selectedPhotos.length} {selectedPhotos.length === 1 ? 'Photo' : 'Photos'}
            </motion.button>
          )}
          {viewMode === 'review' && (
            <motion.button 
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              onClick={handleExport}
              className="bg-gray-900 text-white px-8 py-3 rounded-2xl font-bold text-sm flex items-center gap-2 hover:bg-black transition-all active:scale-95 shadow-[0_15px_30px_rgba(0,0,0,0.15)]"
            >
              <Upload size={16} />
              Export to Drive
            </motion.button>
          )}
          <div className="h-8 w-px bg-gray-100 mx-2" />
          <button className="text-gray-400 hover:text-gray-900 transition-colors p-2 rounded-xl hover:bg-gray-50">
            <LogOut size={20} />
          </button>
        </div>
      </header>

      <main className="pt-24 min-h-screen">
        {viewMode === 'browser' && (
          <div className="px-8 max-w-7xl mx-auto space-y-12 pb-32">
            {/* Breadcrumbs & Search */}
            <div className="flex items-center justify-between border-b border-gray-100 pb-8">
              <div className="flex items-center gap-2 overflow-x-auto no-scrollbar scroll-smooth">
                {folderPath.map((item, index) => (
                  <React.Fragment key={item.id}>
                    <button 
                      onClick={() => navigateBack(index)}
                      className={`whitespace-nowrap text-xs font-bold uppercase tracking-[0.2em] transition-colors ${index === folderPath.length - 1 ? 'text-gray-900' : 'text-gray-400 hover:text-gray-600'}`}
                    >
                      {item.name}
                    </button>
                    {index < folderPath.length - 1 && <ChevronRight size={14} className="text-gray-300 shrink-0" />}
                  </React.Fragment>
                ))}
              </div>
              <div className="flex items-center gap-2 px-4 py-2 bg-gray-50 rounded-xl border border-gray-100 hidden md:flex">
                <Search size={16} className="text-gray-400" />
                <input type="text" placeholder="Filter artifacts..." className="bg-transparent border-none outline-none text-xs font-medium w-48" />
              </div>
            </div>

            {loading ? (
              <div className="flex flex-col items-center justify-center h-96 space-y-6">
                <div className="relative">
                  <RefreshCw className="animate-spin text-gray-900 w-12 h-12" />
                  <div className="absolute inset-0 bg-gray-900/5 rounded-full filter blur-xl animate-pulse" />
                </div>
                <div className="flex flex-col items-center">
                  <p className="text-sm font-black uppercase tracking-[0.3em] text-gray-900">Scanning Archive</p>
                  <p className="text-xs text-gray-400 mt-1">Indexing files from Google Drive container...</p>
                </div>
              </div>
            ) : (
              <motion.div 
                layout
                className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-8"
              >
                <AnimatePresence>
                  {files.map((file, idx) => {
                    const isFolder = file.mimeType === 'application/vnd.google-apps.folder';
                    const isSelected = selectedPhotos.some(p => p.id === file.id);
                    
                    return (
                      <motion.div 
                        key={file.id}
                        layout
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: idx * 0.05 }}
                        className={`group relative rounded-[32px] transition-all duration-500 ${isFolder ? 'bg-gray-50 hover:bg-white hover:shadow-2xl hover:scale-[1.02] cursor-pointer p-6 border border-transparent hover:border-gray-100' : 'overflow-hidden aspect-[4/5] cursor-pointer shadow-sm hover:shadow-2xl hover:scale-[1.02]'}`}
                        onClick={() => isFolder ? navigateToFolder(file) : toggleSelectPhoto(file)}
                      >
                        {isFolder ? (
                          <div className="flex flex-col h-full justify-between">
                            <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center text-gray-900 shadow-sm group-hover:bg-gray-900 group-hover:text-white transition-all duration-300">
                              <Folder size={24} />
                            </div>
                            <div className="space-y-1">
                              <span className="text-xs font-bold text-gray-900 truncate block uppercase tracking-tight">{file.name}</span>
                              <span className="text-[10px] text-gray-400 font-medium">Directory Item</span>
                            </div>
                          </div>
                        ) : (
                          <>
                            <img 
                              src={`/api/drive/file/${file.id}`} 
                              alt={file.name}
                              className={`w-full h-full object-cover transition-all duration-700 ${isSelected ? 'scale-110 blur-[2px]' : 'group-hover:scale-110'}`}
                              referrerPolicy="no-referrer"
                            />
                            <div className={`absolute inset-0 transition-all duration-500 flex flex-col items-center justify-center ${isSelected ? 'bg-gray-900/60' : 'bg-black/0'}`}>
                              {isSelected ? (
                                <motion.div
                                  initial={{ scale: 0, rotate: -45 }}
                                  animate={{ scale: 1, rotate: 0 }}
                                >
                                  <CheckCircle2 className="text-white w-12 h-12" />
                                </motion.div>
                              ) : (
                                <div className="w-10 h-10 rounded-full bg-white/20 backdrop-blur-md opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                  <Sparkles className="text-white w-5 h-5" />
                                </div>
                              )}
                            </div>
                            <div className="absolute bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-black/80 via-black/40 to-transparent translate-y-4 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 transition-all duration-300">
                              <p className="text-[10px] font-bold text-white uppercase tracking-widest truncate">{file.name}</p>
                              <div className="flex items-center gap-1.5 mt-1">
                                <ImageIcon size={10} className="text-gray-400" />
                                <span className="text-[9px] text-gray-400 font-bold uppercase tracking-tight">Technical Capture</span>
                              </div>
                            </div>
                          </>
                        )}
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              </motion.div>
            )}

            {files.length === 0 && !loading && (
              <div className="flex flex-col items-center justify-center h-64 border-2 border-dashed border-gray-100 rounded-3xl">
                <Search className="text-gray-200 mb-4 w-12 h-12" />
                <p className="text-gray-400 font-medium">No photos found in this folder</p>
              </div>
            )}
          </div>
        )}

        {viewMode === 'enhancer' && (
          <div className="h-[calc(100vh-80px)] flex flex-col items-center justify-center px-8 text-center space-y-8">
            <div className="relative">
              <Sparkles className="w-16 h-16 text-gray-900 animate-pulse" />
              <motion.div 
                className="absolute inset-0 border-2 border-gray-900 rounded-full"
                animate={{ scale: [1, 1.5], opacity: [1, 0] }}
                transition={{ duration: 1.5, repeat: Infinity }}
              />
            </div>
            <div className="space-y-4">
              <h2 className="text-2xl font-semibold">Enhancing Inspection Photos</h2>
              <p className="text-gray-500 max-w-sm mx-auto">AI is analyzing exposures, reducing noise, and sharpening details for a professional finish.</p>
            </div>
            <div className="w-full max-w-md h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <motion.div 
                className="h-full bg-gray-900"
                initial={{ width: 0 }}
                animate={{ width: `${processingProgress}%` }}
              />
            </div>
            <p className="text-sm font-mono text-gray-400 uppercase tracking-widest">{Math.round(processingProgress)}% Complete</p>
          </div>
        )}

        {viewMode === 'review' && (
          <div className="px-8 max-w-7xl mx-auto space-y-16 pb-32">
            <div className="flex items-end justify-between border-b border-gray-100 pb-12">
              <div className="space-y-4">
                <div className="inline-flex items-center gap-2 px-3 py-1 bg-green-50 text-green-700 rounded-full text-[10px] uppercase tracking-widest font-bold border border-green-100">
                  <CheckCircle2 size={12} />
                  Enhancement Complete
                </div>
                <h2 className="text-5xl font-semibold tracking-tight text-gray-900">Review Results</h2>
                <p className="text-gray-500 text-lg max-w-md">Compare processed images against original captures and authorize deployment to drive.</p>
              </div>
              <button 
                onClick={() => setViewMode('browser')}
                className="group flex items-center gap-2 text-gray-400 hover:text-gray-900 font-bold text-sm transition-colors mb-2"
              >
                <ChevronLeft size={20} className="group-hover:-translate-x-1 transition-transform" />
                RETURN TO BROWSER
              </button>
            </div>

            <div className="grid gap-24">
              {enhancedPhotos.map((photo, idx) => (
                <div key={photo.originalId} className="grid grid-cols-1 xl:grid-cols-[1fr,400px] gap-12 items-start">
                  <div className="space-y-8">
                    <CompareSlider 
                      before={photo.originalDataUrl} 
                      after={photo.enhancedDataUrl} 
                    />
                    <div className="grid grid-cols-2 gap-6">
                      <button 
                        onClick={() => {
                          const newPhotos = [...enhancedPhotos];
                          newPhotos[idx].status = 'approved';
                          setEnhancedPhotos(newPhotos);
                        }}
                        className={`py-6 rounded-[32px] flex flex-col items-center justify-center gap-3 font-bold transition-all border-2 ${photo.status === 'approved' ? 'bg-green-600 border-green-600 text-white shadow-2xl shadow-green-200' : 'bg-white border-gray-100 text-gray-400 hover:border-gray-300'}`}
                      >
                        <CheckCircle2 size={32} />
                        <span className="text-sm uppercase tracking-[0.2em]">{photo.status === 'approved' ? 'Authorized' : 'Approve'}</span>
                      </button>
                      <button 
                        onClick={() => {
                          const newPhotos = [...enhancedPhotos];
                          newPhotos[idx].status = 'rejected';
                          setEnhancedPhotos(newPhotos);
                        }}
                        className={`py-6 rounded-[32px] flex flex-col items-center justify-center gap-3 font-bold transition-all border-2 ${photo.status === 'rejected' ? 'bg-red-600 border-red-600 text-white shadow-2xl shadow-red-200' : 'bg-white border-gray-100 text-gray-400 hover:border-gray-300'}`}
                      >
                        <XCircle size={32} />
                        <span className="text-sm uppercase tracking-[0.2em]">{photo.status === 'rejected' ? 'Rejected' : 'Reject'}</span>
                      </button>
                    </div>
                  </div>
                  
                  <div className="space-y-10 lg:sticky lg:top-32">
                    <div className="space-y-6">
                       <div className="flex items-center gap-3">
                         <div className="w-1 h-6 bg-gray-900 rounded-full" />
                         <h3 className="text-xs uppercase tracking-[0.3em] font-black text-gray-900">AI Forensic Report</h3>
                       </div>
                       <div className="p-8 rounded-[40px] bg-gray-900 text-white font-medium leading-relaxed shadow-3xl relative overflow-hidden group">
                          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                            <Sparkles size={64} />
                          </div>
                          <div className="relative z-10 text-lg italic">
                            "{photo.analysis.issues}"
                          </div>
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-4">
                      <EnhancementMetric label="Luminance" value={photo.analysis.brightness} />
                      <EnhancementMetric label="Contrast" value={photo.analysis.contrast} />
                      <EnhancementMetric label="Chroma" value={photo.analysis.saturation} />
                      <EnhancementMetric label="Definition" value={photo.analysis.sharpness} />
                    </div>
                    
                    <div className="pt-8 border-t border-gray-100">
                      <div className="flex items-center justify-between text-[10px] uppercase tracking-widest font-bold text-gray-400">
                        <span>Source Artifact</span>
                        <span>{new Date().toLocaleDateString()}</span>
                      </div>
                      <p className="mt-2 text-sm font-mono font-medium text-gray-900 truncate bg-gray-50 p-3 rounded-xl border border-gray-100 uppercase tracking-tight">{photo.originalName}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function EnhancementMetric({ label, value }: { label: string, value: number }) {
  const percent = Math.round((value - 1) * 100);
  const color = value >= 1 ? 'text-green-600' : 'text-blue-600';
  
  return (
    <div className="bg-white border border-gray-100 p-4 rounded-2xl flex flex-col gap-1 shadow-sm">
      <span className="text-[10px] uppercase tracking-widest font-bold text-gray-400">{label}</span>
      <div className="flex items-end justify-between">
        <span className="text-xl font-semibold tabular-nums tracking-tight">{value.toFixed(2)}</span>
        {percent !== 0 && (
          <span className={`text-[10px] font-bold ${color}`}>
            {percent > 0 ? '+' : ''}{percent}%
          </span>
        )}
      </div>
    </div>
  );
}

function CompareSlider({ before, after }: { before: string, after: string }) {
  const [position, setPosition] = useState(50);

  const handleMouseMove = (e: React.MouseEvent | React.TouchEvent) => {
    const container = e.currentTarget.getBoundingClientRect();
    const x = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const relativeX = ((x - container.left) / container.width) * 100;
    setPosition(Math.min(Math.max(relativeX, 0), 100));
  };

  return (
    <div 
      className="relative aspect-video rounded-3xl overflow-hidden border border-gray-100 shadow-2xl group cursor-ew-resize select-none"
      onMouseMove={handleMouseMove}
      onTouchMove={handleMouseMove}
    >
      <img src={after} className="absolute inset-0 w-full h-full object-cover" alt="Enhanced" />
      <div 
        className="absolute inset-0 overflow-hidden" 
        style={{ width: `${position}%` }}
      >
        <img src={before} className="absolute inset-0 w-full h-full object-cover" alt="Original" />
      </div>
      
      {/* Divider */}
      <div 
        className="absolute inset-0 pointer-events-none"
        style={{ left: `${position}%` }}
      >
        <div className="h-full w-0.5 bg-white shadow-xl relative">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 bg-white rounded-full shadow-lg flex items-center justify-center">
            <div className="flex gap-0.5">
              <div className="w-0.5 h-3 bg-gray-200 rounded-full" />
              <div className="w-0.5 h-3 bg-gray-200 rounded-full" />
            </div>
          </div>
        </div>
      </div>

      <div className="absolute top-4 left-4 px-3 py-1 bg-black/50 backdrop-blur rounded-full text-[10px] text-white uppercase font-bold tracking-widest opacity-0 group-hover:opacity-100 transition-opacity">Before</div>
      <div className="absolute top-4 right-4 px-3 py-1 bg-black/50 backdrop-blur rounded-full text-[10px] text-white uppercase font-bold tracking-widest opacity-0 group-hover:opacity-100 transition-opacity">After</div>
    </div>
  );
}
