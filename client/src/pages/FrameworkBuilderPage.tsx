import { useState, useRef, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { Sparkles, Loader2, Check, Send, RotateCcw, Save, MessageSquare, Paperclip, X, FileText } from "lucide-react";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  attachments?: Array<{ filename: string; charCount: number }>;
}

interface UploadedFile {
  filename: string;
  content: string;
  charCount: number;
  truncated: boolean;
}

export default function FrameworkBuilderPage() {
  const queryClient = useQueryClient();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [draft, setDraft] = useState<any>(null);
  const [saved, setSaved] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + "px";
    }
  }, [input]);

  const chatMutation = useMutation({
    mutationFn: async (userMessage: string) => {
      const updatedMessages = [...messages, { role: "user" as const, content: userMessage }];
      const fileContext = uploadedFiles.length > 0
        ? uploadedFiles.map((f) => ({ filename: f.filename, content: f.content }))
        : undefined;
      return api.chatFrameworkBuilder(updatedMessages, draft, fileContext);
    },
    onSuccess: (data, userMessage) => {
      setMessages((prev) => [
        ...prev,
        { role: "user", content: userMessage, attachments: undefined },
        { role: "assistant", content: data.message },
      ]);
      if (data.frameworkDraft) {
        setDraft(data.frameworkDraft);
      }
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!draft) throw new Error("No framework draft to save");

      // Create framework with all metadata
      const fw = await api.createFramework({
        name: draft.name,
        topicDescription: draft.topicDescription || "",
        scoringMode: "binary",
        searchTemplates: draft.searchTemplates || null,
        negativeKeywords: draft.negativeKeywords || null,
        negativeDomains: draft.negativeDomains || null,
      });

      // Create measures from categories
      const measures = draft.categories.flatMap((cat: any, catIdx: number) =>
        cat.measures.map((m: any, mIdx: number) => ({
          measureId: m.measureId,
          title: m.title,
          definition: m.definition,
          category: cat.name,
          categoryNumber: catIdx + 1,
          displayOrder: mIdx + 1,
          scoringGuidance: m.scoringGuidance || null,
          evidenceKeywords: m.evidenceKeywords || null,
        }))
      );

      await api.bulkCreateMeasures(fw.id, measures);
      await api.activateFramework(fw.id);
      return fw;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["frameworks"] });
      setSaved(true);
    },
  });

  const handleSend = () => {
    if (!input.trim() || chatMutation.isPending) return;
    const msg = input.trim();
    setInput("");
    chatMutation.mutate(msg);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleNewChat = () => {
    setMessages([]);
    setDraft(null);
    setSaved(false);
    setUploadedFiles([]);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsUploading(true);
    try {
      for (const file of Array.from(files)) {
        const result = await api.uploadFrameworkFile(file);
        setUploadedFiles((prev) => [
          ...prev,
          {
            filename: result.filename,
            content: result.content,
            charCount: result.charCount,
            truncated: result.truncated,
          },
        ]);
      }
    } catch (err: any) {
      console.error("Upload failed:", err.message);
    } finally {
      setIsUploading(false);
      // Reset file input
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const removeFile = (index: number) => {
    setUploadedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  // Render markdown-like content (basic formatting)
  const renderContent = (content: string) => {
    // Remove the JSON block from display (it's captured in the draft)
    const displayContent = content.replace(/```json[\s\S]*?```/g, "").trim();
    
    // Split into paragraphs and render
    return displayContent.split("\n").map((line, i) => {
      // Headers
      if (line.startsWith("### ")) return <h4 key={i} className="font-semibold text-gray-900 mt-3 mb-1">{line.slice(4)}</h4>;
      if (line.startsWith("## ")) return <h3 key={i} className="font-bold text-gray-900 mt-4 mb-2">{line.slice(3)}</h3>;
      if (line.startsWith("# ")) return <h2 key={i} className="text-lg font-bold text-gray-900 mt-4 mb-2">{line.slice(2)}</h2>;
      
      // Checklist items
      if (line.startsWith("- [ ] ")) return <div key={i} className="flex items-start gap-2 ml-2 my-0.5"><input type="checkbox" disabled className="mt-1" /><span className="text-sm text-gray-700">{line.slice(6)}</span></div>;
      if (line.startsWith("- [x] ")) return <div key={i} className="flex items-start gap-2 ml-2 my-0.5"><input type="checkbox" checked disabled className="mt-1" /><span className="text-sm text-gray-700 line-through">{line.slice(6)}</span></div>;
      
      // Bullet points
      if (line.startsWith("- ")) return <li key={i} className="text-sm text-gray-700 ml-4 my-0.5">{line.slice(2)}</li>;
      if (line.match(/^\d+\. /)) return <li key={i} className="text-sm text-gray-700 ml-4 my-0.5 list-decimal">{line.replace(/^\d+\. /, "")}</li>;
      
      // Bold text
      if (line.includes("**")) {
        const parts = line.split(/\*\*(.*?)\*\*/g);
        return <p key={i} className="text-sm text-gray-700 my-1">{parts.map((part, j) => j % 2 === 1 ? <strong key={j}>{part}</strong> : part)}</p>;
      }
      
      // Empty lines
      if (!line.trim()) return <div key={i} className="h-2" />;
      
      // Regular text
      return <p key={i} className="text-sm text-gray-700 my-1">{line}</p>;
    });
  };

  return (
    <div className="max-w-4xl mx-auto flex flex-col h-[calc(100vh-120px)]">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Sparkles className="w-6 h-6 text-blue-600" />
            AI Framework Builder
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Have a conversation to design a rigorous assessment framework. The AI will ask questions, make suggestions, and refine until the template is comprehensive.
          </p>
        </div>
        <div className="flex gap-2">
          {draft && !saved && (
            <button
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending}
              className="flex items-center gap-2 px-3 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 text-sm"
            >
              {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Save & Activate
            </button>
          )}
          {saved && (
            <span className="flex items-center gap-2 px-3 py-2 bg-green-50 text-green-700 rounded-lg text-sm border border-green-200">
              <Check className="w-4 h-4" />
              Framework Saved
            </span>
          )}
          <button
            onClick={handleNewChat}
            className="flex items-center gap-2 px-3 py-2 border rounded-lg text-sm hover:bg-gray-50 text-gray-600"
          >
            <RotateCcw className="w-4 h-4" />
            New Chat
          </button>
        </div>
      </div>

      {/* Chat Messages */}
      <div className="flex-1 overflow-y-auto bg-white rounded-lg border mb-4 p-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-center py-12 space-y-4">
            <MessageSquare className="w-12 h-12 text-gray-300 mx-auto" />
            <div>
              <h3 className="text-lg font-medium text-gray-700">Start designing your framework</h3>
              <p className="text-sm text-gray-500 mt-2 max-w-lg mx-auto">
                Describe what you want to assess companies on. You can also upload reference files (PDFs, documents, spreadsheets) to help inform the template design.
              </p>
            </div>
            <div className="flex flex-wrap gap-2 justify-center mt-4">
              {[
                "I want to assess corporate AI governance practices",
                "Help me build a climate risk disclosure framework",
                "I need to evaluate cybersecurity governance",
                "Suggest topics for a supply chain transparency assessment",
              ].map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => { setInput(suggestion); }}
                  className="px-3 py-1.5 bg-blue-50 text-blue-700 rounded-full text-xs hover:bg-blue-100 transition-colors"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, idx) => (
          <div key={idx} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[85%] rounded-lg px-4 py-3 ${
                msg.role === "user"
                  ? "bg-blue-600 text-white"
                  : "bg-gray-50 border border-gray-200"
              }`}
            >
              {msg.role === "user" ? (
                <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
              ) : (
                <div className="prose prose-sm max-w-none">{renderContent(msg.content)}</div>
              )}
            </div>
          </div>
        ))}

        {chatMutation.isPending && (
          <div className="flex justify-start">
            <div className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-3">
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <Loader2 className="w-4 h-4 animate-spin" />
                Thinking...
              </div>
            </div>
          </div>
        )}

        {chatMutation.isError && (
          <div className="flex justify-start">
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3">
              <p className="text-sm text-red-600">Error: {(chatMutation.error as Error).message}</p>
            </div>
          </div>
        )}

        <div ref={chatEndRef} />
      </div>

      {/* Draft Preview Banner */}
      {draft && !saved && (
        <div className="mb-4 bg-green-50 border border-green-200 rounded-lg p-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-green-800">
                Framework draft ready: <strong>{draft.name}</strong>
              </p>
              <p className="text-xs text-green-600 mt-0.5">
                {draft.categories?.length} categories, {draft.categories?.reduce((sum: number, c: any) => sum + c.measures.length, 0)} measures
              </p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending}
                className="flex items-center gap-2 px-3 py-1.5 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 text-xs"
              >
                {saveMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                Save & Activate
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Uploaded Files Display */}
      {uploadedFiles.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {uploadedFiles.map((file, idx) => (
            <div
              key={idx}
              className="flex items-center gap-1.5 px-2.5 py-1.5 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-700"
            >
              <FileText className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="max-w-[150px] truncate" title={file.filename}>{file.filename}</span>
              <span className="text-blue-400">
                ({file.truncated ? "100k+" : `${Math.round(file.charCount / 1000)}k`} chars)
              </span>
              <button
                onClick={() => removeFile(idx)}
                className="ml-0.5 p-0.5 hover:bg-blue-100 rounded"
                title="Remove file"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Input Area */}
      <div className="bg-white rounded-lg border p-3 flex gap-2 items-end">
        {/* File upload button */}
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading}
          className="flex items-center justify-center w-10 h-10 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors disabled:opacity-50"
          title="Upload reference files (PDF, DOCX, TXT, CSV, XLSX)"
        >
          {isUploading ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            <Paperclip className="w-5 h-5" />
          )}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.doc,.docx,.txt,.csv,.json,.md,.xlsx,.xls"
          multiple
          className="hidden"
          onChange={handleFileUpload}
        />
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={messages.length === 0 
            ? "Describe what you want to assess companies on..." 
            : "Type your response... (Enter to send, Shift+Enter for new line)"}
          className="flex-1 resize-none px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none min-h-[40px] max-h-[200px]"
          rows={1}
        />
        <button
          onClick={handleSend}
          disabled={!input.trim() || chatMutation.isPending}
          className="flex items-center justify-center w-10 h-10 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
