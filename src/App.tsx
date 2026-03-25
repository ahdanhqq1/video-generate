/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { GoogleGenAI } from "@google/genai";
import { motion, AnimatePresence } from "motion/react";
import { 
  Video, 
  Image as ImageIcon, 
  Type, 
  Sparkles, 
  Download, 
  Loader2, 
  AlertCircle, 
  Key,
  Play,
  ArrowRight,
  Upload,
  X,
  LogIn,
  LogOut,
  Settings,
  User as UserIcon,
  CheckCircle2
} from "lucide-react";
import { auth, googleProvider, signInWithPopup, signOut, onAuthStateChanged, db, User } from './firebase';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';

// --- Types ---
declare global {
  interface Window {
    aistudio?: {
      hasSelectedApiKey: () => Promise<boolean>;
      openSelectKey: () => Promise<void>;
    };
  }
}

type GenerationMode = 'video' | 'image';

interface GenerationResult {
  type: GenerationMode;
  url: string;
  prompt: string;
  timestamp: number;
}

// --- Constants ---
const VEO_MODEL = 'veo-3.1-fast-generate-preview';
const IMAGE_MODEL = 'gemini-2.5-flash-image';

// --- Helper Functions ---
const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const base64String = (reader.result as string).split(',')[1];
      resolve(base64String);
    };
    reader.onerror = (error) => reject(error);
  });
};

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [customApiKey, setCustomApiKey] = useState<string>('');
  const [showSettings, setShowSettings] = useState(false);
  const [mode, setMode] = useState<GenerationMode>('video');
  
  const [prompt, setPrompt] = useState('');
  const [image, setImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [currentResult, setCurrentResult] = useState<GenerationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<GenerationResult[]>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        await fetchUserSettings(currentUser.uid);
      }
      setLoading(false);
      checkApiKey();
    });
    return () => unsubscribe();
  }, []);

  const fetchUserSettings = async (uid: string) => {
    try {
      const userDoc = await getDoc(doc(db, 'users', uid));
      if (userDoc.exists()) {
        const data = userDoc.data();
        if (data.customApiKey) {
          setCustomApiKey(data.customApiKey);
        }
      } else {
        // Create initial user doc
        await setDoc(doc(db, 'users', uid), {
          uid,
          email: auth.currentUser?.email || '',
          displayName: auth.currentUser?.displayName || '',
          createdAt: new Date().toISOString()
        });
      }
    } catch (err) {
      console.error("Error fetching user settings:", err);
    }
  };

  const saveApiKey = async () => {
    if (!user) return;
    try {
      await updateDoc(doc(db, 'users', user.uid), {
        customApiKey: customApiKey
      });
      setShowSettings(false);
      checkApiKey();
    } catch (err) {
      console.error("Error saving API Key:", err);
      setError("Failed to save API Key to database.");
    }
  };

  const checkApiKey = async () => {
    // If user has a custom key, that takes precedence
    if (customApiKey) {
      setHasKey(true);
      return;
    }

    if (window.aistudio?.hasSelectedApiKey) {
      const selected = await window.aistudio.hasSelectedApiKey();
      setHasKey(selected);
    } else {
      // If not in AI Studio and no custom key, we might be on Vercel/GitHub
      setHasKey(!!process.env.GEMINI_API_KEY);
    }
  };

  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      console.error("Login Error:", err);
      setError("Failed to login with Google.");
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setCustomApiKey('');
    } catch (err) {
      console.error("Logout Error:", err);
    }
  };

  const handleOpenKeySelector = async () => {
    if (window.aistudio?.openSelectKey) {
      await window.aistudio.openSelectKey();
      setHasKey(true);
    } else {
      setShowSettings(true);
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setImage(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setImagePreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const clearImage = () => {
    setImage(null);
    setImagePreview(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const generate = async () => {
    if (mode === 'video') {
      await generateVideo();
    } else {
      await generateImage();
    }
  };

  const generateImage = async () => {
    if (!prompt.trim() && !image) {
      setError("Please provide a prompt or an image to edit.");
      return;
    }

    setIsGenerating(true);
    setError(null);
    setStatusMessage("Generating image...");

    try {
      const activeKey = customApiKey || process.env.GEMINI_API_KEY;
      if (!activeKey) throw new Error("No API Key found. Please set one in settings.");

      const ai = new GoogleGenAI({ apiKey: activeKey });
      
      let contents: any = { parts: [] };
      
      if (image) {
        const base64Image = await fileToBase64(image);
        contents.parts.push({
          inlineData: {
            data: base64Image,
            mimeType: image.type,
          }
        });
      }
      
      contents.parts.push({ text: prompt || "Generate a beautiful image" });

      const response = await ai.models.generateContent({
        model: IMAGE_MODEL,
        contents,
        config: {
          imageConfig: {
            aspectRatio: "16:9",
          }
        }
      });

      let imageUrl = '';
      for (const part of response.candidates?.[0]?.content?.parts || []) {
        if (part.inlineData) {
          imageUrl = `data:image/png;base64,${part.inlineData.data}`;
          break;
        }
      }

      if (!imageUrl) throw new Error("No image data returned from API.");

      const result: GenerationResult = {
        type: 'image',
        url: imageUrl,
        prompt: prompt || "Image Generation",
        timestamp: Date.now()
      };

      setCurrentResult(result);
      setHistory(prev => [result, ...prev]);
      setIsGenerating(false);
    } catch (err: any) {
      console.error(err);
      setError(err.message || "An error occurred during image generation.");
      setIsGenerating(false);
    }
  };

  const generateVideo = async () => {
    if (!prompt.trim() && !image) {
      setError("Please provide a prompt or an image.");
      return;
    }

    setIsGenerating(true);
    setError(null);
    setStatusMessage("Initializing generation...");

    try {
      // Use custom key if available, otherwise fallback to process.env
      const activeKey = customApiKey || process.env.GEMINI_API_KEY;
      if (!activeKey) throw new Error("No API Key found. Please set one in settings.");

      const ai = new GoogleGenAI({ apiKey: activeKey });
      
      let operation;
      
      if (image) {
        setStatusMessage("Uploading image and starting generation...");
        const base64Image = await fileToBase64(image);
        operation = await ai.models.generateVideos({
          model: VEO_MODEL,
          prompt: prompt || "Generate a video based on this image",
          image: {
            imageBytes: base64Image,
            mimeType: image.type,
          },
          config: {
            numberOfVideos: 1,
            resolution: '720p',
            aspectRatio: '16:9'
          }
        });
      } else {
        setStatusMessage("Starting text-to-video generation...");
        operation = await ai.models.generateVideos({
          model: VEO_MODEL,
          prompt: prompt,
          config: {
            numberOfVideos: 1,
            resolution: '720p',
            aspectRatio: '16:9'
          }
        });
      }

      // Polling
      const loadingMessages = [
        "Analyzing your prompt...",
        "Dreaming up the scenes...",
        "Rendering textures and lighting...",
        "Simulating physics and motion...",
        "Finalizing the cinematic details...",
        "Almost there, polishing the frames..."
      ];
      
      let messageIndex = 0;
      const messageInterval = setInterval(() => {
        messageIndex = (messageIndex + 1) % loadingMessages.length;
        setStatusMessage(loadingMessages[messageIndex]);
      }, 8000);

      while (!operation.done) {
        await new Promise(resolve => setTimeout(resolve, 10000));
        operation = await ai.operations.getVideosOperation({ operation: operation });
      }

      clearInterval(messageInterval);
      setStatusMessage("Video ready! Fetching...");

      const downloadLink = operation.response?.generatedVideos?.[0]?.video?.uri;
      if (!downloadLink) throw new Error("No video URL returned from API.");

      const videoResponse = await fetch(downloadLink, {
        method: 'GET',
        headers: {
          'x-goog-api-key': activeKey,
        },
      });

      if (!videoResponse.ok) throw new Error("Failed to download video data.");
      
      const blob = await videoResponse.blob();
      const videoUrl = URL.createObjectURL(blob);

      const result: GenerationResult = {
        type: 'video',
        url: videoUrl,
        prompt: prompt || "Image-to-Video",
        timestamp: Date.now()
      };

      setCurrentResult(result);
      setHistory(prev => [result, ...prev]);
      setIsGenerating(false);
    } catch (err: any) {
      console.error(err);
      setError(err.message || "An error occurred during generation.");
      setIsGenerating(false);
      
      if (err.message?.includes("Requested entity was not found")) {
        setHasKey(false);
      }
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0502] flex items-center justify-center">
        <Loader2 className="w-12 h-12 text-orange-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0502] text-[#e0d8d0] font-sans selection:bg-orange-500/30">
      {/* Background Atmosphere */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none z-0">
        <div className="absolute top-[-10%] left-[-10%] w-[60%] h-[60%] bg-orange-900/20 blur-[120px] rounded-full" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-orange-950/20 blur-[100px] rounded-full" />
      </div>

      {/* Navigation Bar */}
      <nav className="relative z-20 border-b border-white/5 bg-black/20 backdrop-blur-md px-6 py-4">
        <div className="max-w-6xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-orange-500 rounded-lg flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-black" />
            </div>
            <span className="text-sm font-bold tracking-widest uppercase">Veo Studio</span>
          </div>
          
          <div className="flex items-center gap-4">
            {user ? (
              <div className="flex items-center gap-4">
                <button 
                  onClick={() => setShowSettings(true)}
                  className="p-2 hover:bg-white/5 rounded-full transition-colors"
                  title="Settings"
                >
                  <Settings className="w-5 h-5 opacity-60 hover:opacity-100" />
                </button>
                <div className="flex items-center gap-3 bg-white/5 pl-3 pr-1 py-1 rounded-full border border-white/10">
                  <span className="text-xs font-medium opacity-80">{user.displayName}</span>
                  <img src={user.photoURL || ''} alt="Avatar" className="w-7 h-7 rounded-full border border-white/10" />
                  <button onClick={handleLogout} className="p-1.5 hover:bg-white/10 rounded-full transition-colors">
                    <LogOut className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ) : (
              <button 
                onClick={handleLogin}
                className="flex items-center gap-2 px-4 py-2 bg-white text-black text-sm font-bold rounded-full hover:bg-gray-200 transition-colors"
              >
                <LogIn className="w-4 h-4" />
                Login with Google
              </button>
            )}
          </div>
        </div>
      </nav>

      <main className="relative z-10 max-w-6xl mx-auto px-6 py-12">
        {/* Header */}
        <header className="mb-16 flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div>
            <h1 className="text-5xl md:text-7xl font-light tracking-tight leading-none">
              Cinematic <br />
              <span className="italic font-serif text-orange-500">
                {mode === 'video' ? 'Motion' : 'Vision'}
              </span>
            </h1>
          </div>
          <p className="max-w-xs text-sm text-gray-400 leading-relaxed">
            Transform your imagination into high-quality {mode === 'video' ? 'video' : 'images'} using advanced AI.
          </p>
        </header>

        {/* Mode Selector */}
        <div className="flex gap-4 mb-12">
          <button 
            onClick={() => setMode('video')}
            className={`flex items-center gap-2 px-6 py-3 rounded-2xl font-bold transition-all ${mode === 'video' ? 'bg-orange-500 text-black' : 'bg-white/5 text-gray-400 hover:bg-white/10'}`}
          >
            <Video className="w-5 h-5" /> Video
          </button>
          <button 
            onClick={() => setMode('image')}
            className={`flex items-center gap-2 px-6 py-3 rounded-2xl font-bold transition-all ${mode === 'image' ? 'bg-orange-500 text-black' : 'bg-white/5 text-gray-400 hover:bg-white/10'}`}
          >
            <ImageIcon className="w-5 h-5" /> Image
          </button>
        </div>

        {/* API Key Warning */}
        {!hasKey && !customApiKey && (
          <div className="mb-12 p-6 bg-orange-500/10 border border-orange-500/20 rounded-3xl flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 bg-orange-500/20 rounded-full flex items-center justify-center shrink-0">
                <Key className="w-6 h-6 text-orange-500" />
              </div>
              <div>
                <h3 className="text-lg font-bold">API Key Required</h3>
                <p className="text-sm text-gray-400">
                  To generate {mode === 'video' ? 'videos' : 'images'}, you need a Gemini API Key.
                </p>
              </div>
            </div>
            <button 
              onClick={() => user ? setShowSettings(true) : handleLogin()}
              className="px-6 py-3 bg-orange-500 text-black font-bold rounded-xl hover:bg-orange-600 transition-all shrink-0"
            >
              {user ? "Set API Key" : "Login to Set Key"}
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
          {/* Input Section */}
          <section className="lg:col-span-5 space-y-8">
            <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl p-8 space-y-6 shadow-2xl">
              {/* Mode Toggle Info */}
              <div className="flex items-center gap-4 text-xs font-bold tracking-widest uppercase opacity-50">
                <span className={image ? 'text-orange-500 opacity-100' : ''}>
                  {mode === 'video' ? 'Image to Video' : 'Image Editing'}
                </span>
                <ArrowRight className="w-3 h-3" />
                <span className={!image ? 'text-orange-500 opacity-100' : ''}>
                  {mode === 'video' ? 'Text to Video' : 'Text to Image'}
                </span>
              </div>

              {/* Image Upload Area */}
              <div className="relative">
                {!imagePreview ? (
                  <button 
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full aspect-video border-2 border-dashed border-white/10 rounded-2xl flex flex-col items-center justify-center gap-3 hover:border-orange-500/50 hover:bg-white/5 transition-all group"
                  >
                    <div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center group-hover:scale-110 transition-transform">
                      <Upload className="w-6 h-6 text-gray-400" />
                    </div>
                    <span className="text-sm font-medium text-gray-400">
                      {mode === 'video' ? 'Upload starting image (optional)' : 'Upload reference image (optional)'}
                    </span>
                  </button>
                ) : (
                  <div className="relative aspect-video rounded-2xl overflow-hidden border border-white/10">
                    <img src={imagePreview} alt="Preview" className="w-full h-full object-cover" />
                    <button 
                      onClick={clearImage}
                      className="absolute top-3 right-3 p-2 bg-black/60 backdrop-blur-md rounded-full hover:bg-red-500 transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                )}
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  onChange={handleImageUpload} 
                  accept="image/*" 
                  className="hidden" 
                />
              </div>

              {/* Prompt Input */}
              <div className="space-y-3">
                <label className="text-xs font-bold tracking-widest uppercase opacity-50 flex items-center gap-2">
                  <Type className="w-3 h-3" /> Prompt
                </label>
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder={mode === 'video' ? "Describe the motion, lighting, and scene..." : "Describe the image you want to create..."}
                  className="w-full bg-white/5 border border-white/10 rounded-2xl p-4 min-h-[120px] focus:outline-none focus:border-orange-500/50 transition-colors resize-none text-lg"
                />
              </div>

              {/* Action Button */}
              <button
                onClick={generate}
                disabled={isGenerating || (!prompt.trim() && !image)}
                className="w-full py-5 bg-orange-500 disabled:bg-white/10 disabled:text-gray-500 hover:bg-orange-600 text-black font-bold rounded-2xl transition-all flex items-center justify-center gap-3 text-lg shadow-lg shadow-orange-500/20"
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="w-6 h-6 animate-spin" />
                    <span>Generating...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-6 h-6" />
                    <span>Create {mode === 'video' ? 'Video' : 'Image'}</span>
                  </>
                )}
              </button>

              {error && (
                <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl flex items-start gap-3 text-red-400 text-sm">
                  <AlertCircle className="w-5 h-5 shrink-0" />
                  <p>{error}</p>
                </div>
              )}
            </div>
          </section>

          {/* Output Section */}
          <section className="lg:col-span-7">
            <AnimatePresence mode="wait">
              {isGenerating ? (
                <motion.div 
                  key="loading"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 1.05 }}
                  className="aspect-video bg-white/5 border border-white/10 rounded-3xl flex flex-col items-center justify-center p-12 text-center space-y-6 relative overflow-hidden"
                >
                  <div className="absolute inset-0 opacity-20 pointer-events-none">
                    <div className="absolute inset-0 bg-gradient-to-br from-orange-500/20 to-transparent animate-pulse" />
                  </div>
                  
                  <div className="relative">
                    <Loader2 className="w-16 h-16 text-orange-500 animate-spin mb-4" />
                    <div className="absolute inset-0 blur-xl bg-orange-500/20 animate-pulse" />
                  </div>
                  
                  <div className="space-y-2 relative">
                    <h3 className="text-2xl font-medium">Creating your masterpiece</h3>
                    <p className="text-gray-400 italic font-serif">{statusMessage}</p>
                  </div>
                  
                  <div className="w-full max-w-xs h-1 bg-white/10 rounded-full overflow-hidden">
                    <motion.div 
                      className="h-full bg-orange-500"
                      animate={{ x: ["-100%", "100%"] }}
                      transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                    />
                  </div>
                </motion.div>
              ) : currentResult ? (
                <motion.div 
                  key="result"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="space-y-6"
                >
                  <div className="aspect-video bg-black rounded-3xl overflow-hidden border border-white/10 shadow-2xl group relative">
                    {currentResult.type === 'video' ? (
                      <video 
                        src={currentResult.url} 
                        controls 
                        autoPlay 
                        loop 
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <img 
                        src={currentResult.url} 
                        alt="Generated" 
                        className="w-full h-full object-cover"
                      />
                    )}
                    <div className="absolute top-6 right-6 opacity-0 group-hover:opacity-100 transition-opacity">
                      <a 
                        href={currentResult.url} 
                        download={currentResult.type === 'video' ? "veo-video.mp4" : "generated-image.png"}
                        className="p-3 bg-black/60 backdrop-blur-md rounded-full hover:bg-orange-500 hover:text-black transition-all flex items-center gap-2"
                      >
                        <Download className="w-5 h-5" />
                      </a>
                    </div>
                  </div>
                  
                  <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
                    <h4 className="text-xs font-bold tracking-widest uppercase opacity-50 mb-3">Prompt Used</h4>
                    <p className="text-lg leading-relaxed text-gray-300">{currentResult.prompt}</p>
                  </div>
                </motion.div>
              ) : (
                <div className="aspect-video bg-white/5 border border-white/10 border-dashed rounded-3xl flex flex-col items-center justify-center p-12 text-center text-gray-500 space-y-4">
                  <div className="w-20 h-20 bg-white/5 rounded-full flex items-center justify-center">
                    {mode === 'video' ? <Play className="w-10 h-10 opacity-20" /> : <ImageIcon className="w-10 h-10 opacity-20" />}
                  </div>
                  <p className="text-lg">Your generated {mode} will appear here</p>
                </div>
              )}
            </AnimatePresence>

            {/* History */}
            {history.length > 0 && (
              <div className="mt-12 space-y-6">
                <h3 className="text-xl font-medium flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-orange-500" /> Recent Creations
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                  {history.map((item, idx) => (
                    <button 
                      key={idx}
                      onClick={() => setCurrentResult(item)}
                      className="aspect-video rounded-xl overflow-hidden border border-white/10 hover:border-orange-500/50 transition-all relative group"
                    >
                      {item.type === 'video' ? (
                        <video src={item.url} className="w-full h-full object-cover opacity-60 group-hover:opacity-100 transition-opacity" />
                      ) : (
                        <img src={item.url} className="w-full h-full object-cover opacity-60 group-hover:opacity-100 transition-opacity" />
                      )}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent flex items-end p-3">
                        <div className="flex items-center gap-2 w-full">
                          {item.type === 'video' ? <Video className="w-3 h-3 shrink-0" /> : <ImageIcon className="w-3 h-3 shrink-0" />}
                          <p className="text-[10px] truncate opacity-80">{item.prompt}</p>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </section>
        </div>
      </main>

      {/* Settings Modal */}
      <AnimatePresence>
        {showSettings && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowSettings(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-md bg-[#15100d] border border-white/10 rounded-3xl p-8 shadow-2xl space-y-6"
            >
              <div className="flex justify-between items-center">
                <h2 className="text-2xl font-bold flex items-center gap-2">
                  <Settings className="w-6 h-6 text-orange-500" /> Settings
                </h2>
                <button onClick={() => setShowSettings(false)} className="p-2 hover:bg-white/5 rounded-full">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold tracking-widest uppercase opacity-50">Custom Gemini API Key</label>
                  <div className="relative">
                    <input 
                      type="password"
                      value={customApiKey}
                      onChange={(e) => setCustomApiKey(e.target.value)}
                      placeholder="Enter your API Key..."
                      className="w-full bg-white/5 border border-white/10 rounded-xl p-4 pr-12 focus:outline-none focus:border-orange-500/50 transition-colors"
                    />
                    {customApiKey && (
                      <div className="absolute right-4 top-1/2 -translate-y-1/2">
                        <CheckCircle2 className="w-5 h-5 text-green-500" />
                      </div>
                    )}
                  </div>
                  <p className="text-[10px] text-gray-500 leading-relaxed">
                    This key will be stored securely in your private profile. It allows you to use the app even when deployed on services like Vercel or GitHub.
                  </p>
                </div>

                <button 
                  onClick={saveApiKey}
                  className="w-full py-4 bg-orange-500 hover:bg-orange-600 text-black font-bold rounded-xl transition-all"
                >
                  Save Settings
                </button>
              </div>

              <div className="pt-6 border-t border-white/5">
                <div className="flex items-center gap-4">
                  <img src={user?.photoURL || ''} alt="User" className="w-10 h-10 rounded-full" />
                  <div>
                    <p className="text-sm font-bold">{user?.displayName}</p>
                    <p className="text-xs text-gray-500">{user?.email}</p>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Footer */}
      <footer className="max-w-6xl mx-auto px-6 py-12 border-t border-white/5 mt-12 flex justify-between items-center text-xs text-gray-500">
        <p>© 2026 Veo Studio. Powered by Google Gemini.</p>
        <div className="flex gap-6">
          <a href="#" className="hover:text-orange-500 transition-colors">Terms</a>
          <a href="#" className="hover:text-orange-500 transition-colors">Privacy</a>
        </div>
      </footer>
    </div>
  );
}
