import { Router, Request, Response } from "express";
import multer from "multer";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// ─── File Upload for Chat Context ────────────────────────────────────────────

router.post("/upload", upload.single("file"), async (req: Request, res: Response) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const filename = req.file.originalname;
    const mimeType = req.file.mimetype;
    let extractedText = "";

    if (mimeType === "application/pdf") {
      const pdfParse = (await import("pdf-parse")).default;
      const data = await pdfParse(req.file.buffer);
      extractedText = data.text || "";
      // If pdf-parse returned empty (scanned/image PDF), try basic buffer extraction
      if (!extractedText.trim()) {
        const raw = req.file.buffer.toString("utf-8").replace(/[^\x20-\x7E\n\r\t]/g, " ").replace(/ {3,}/g, " ").trim();
        if (raw.length > 100) {
          extractedText = raw;
        } else {
          extractedText = "[PDF appears to be scanned/image-based. Text extraction was not possible. The filename is: " + filename + "]";
        }
      }
    } else if (
      mimeType === "text/plain" ||
      mimeType === "text/csv" ||
      mimeType === "text/markdown" ||
      mimeType === "application/json"
    ) {
      extractedText = req.file.buffer.toString("utf-8");
    } else if (
      mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      mimeType === "application/msword"
    ) {
      // Basic .docx text extraction via mammoth
      try {
        const mammoth = await import("mammoth");
        const result = await mammoth.extractRawText({ buffer: req.file.buffer });
        extractedText = result.value || "";
      } catch {
        extractedText = req.file.buffer.toString("utf-8").replace(/[^\x20-\x7E\n\r\t]/g, " ");
      }
    } else if (
      mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
      mimeType === "application/vnd.ms-excel"
    ) {
      try {
        const XLSX = await import("xlsx");
        const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
        const sheets: string[] = [];
        for (const sheetName of workbook.SheetNames) {
          const sheet = workbook.Sheets[sheetName];
          sheets.push(`--- Sheet: ${sheetName} ---\n${XLSX.utils.sheet_to_csv(sheet)}`);
        }
        extractedText = sheets.join("\n\n");
      } catch {
        extractedText = "[Could not extract spreadsheet content]";
      }
    } else {
      // Attempt plain text extraction as fallback
      extractedText = req.file.buffer.toString("utf-8").replace(/[^\x20-\x7E\n\r\t]/g, " ");
    }

    // Truncate very large files to avoid exceeding LLM context
    const MAX_CHARS = 100000;
    const truncated = extractedText.length > MAX_CHARS;
    if (truncated) {
      extractedText = extractedText.slice(0, MAX_CHARS);
    }

    res.json({
      filename,
      mimeType,
      charCount: extractedText.length,
      truncated,
      content: extractedText,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Framework Builder Chat (Conversational AI) ─────────────────────────────

router.post("/chat", async (req: Request, res: Response) => {
  try {
    const { messages, currentDraft, fileContext } = req.body;
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "Messages array required" });
    }

    const { completeWithFallback } = await import("../lib/ai-providers.js");

    const systemPrompt = `You are an expert assessment framework designer working within the CompanyIQ platform. Your role is to help the user create a rigorous, comprehensive, and precise framework template for evaluating companies based on their public disclosures.

CONTEXT: The framework you create will be used to:
1. DISCOVER relevant documents via web search (using the framework's topic description and search templates)
2. RETRIEVE evidence passages from those documents using BM25 keyword matching (using measure titles, definitions, and evidenceKeywords)
3. SCORE each measure using an LLM that receives the measure title, definition, scoringGuidance, and extracted evidence

Therefore, the quality of the template DIRECTLY determines the quality of the analysis. Vague measures produce unreliable results.

YOUR BEHAVIOR:
- Start by understanding what the user wants to assess
- Ask clarifying questions about scope, boundaries, and evidence types
- Make PROACTIVE SUGGESTIONS on topics, categories, and specific measures
- When suggesting measures, always provide the full detail (title, definition, scoringGuidance)
- Challenge vague or ambiguous requirements — push for specificity
- Suggest relevant industry standards, frameworks, or regulations that could inform the assessment
- Continue the conversation until you are confident the template is:
  (a) Comprehensive — covers all important aspects of the topic
  (b) Precise — each measure has a clear, unambiguous definition
  (c) Observable — all measures can be answered from public corporate disclosures
  (d) Well-structured — measures are logically grouped and non-overlapping
  (e) Rigorous — scoring guidance is specific enough for consistent results

WHEN YOU HAVE ENOUGH INFORMATION, generate the complete framework as a JSON block in your response. The JSON must follow this exact structure:
\`\`\`json
{
  "name": "Framework Name",
  "topicDescription": "A comprehensive 150-300 word description of the assessment scope, evidence types, relevant standards, and exclusions",
  "searchTemplates": ["{company} sustainability report AI governance", "{company} artificial intelligence policy"],
  "negativeKeywords": ["keywords that indicate irrelevant documents"],
  "negativeDomains": ["domains to exclude"],
  "categories": [
    {
      "name": "Category Name",
      "measures": [
        {
          "measureId": "1.1-short-slug",
          "title": "Does the company...? (specific, assessable question)",
          "definition": "Detailed 50-150 word definition of what constitutes a YES answer. Must describe observable evidence in public documents.",
          "scoringGuidance": {
            "yes": "Specific evidence that must be present for a YES verdict. Name exact document types, committee names, policy elements, etc.",
            "no": "What absence or condition constitutes a NO. Be specific about what was searched for and not found.",
            "partial": "What constitutes partial compliance — evidence exists but is incomplete or indirect."
          },
          "evidenceKeywords": ["keywords", "that help", "find relevant", "passages in documents"]
        }
      ]
    }
  ]
}
\`\`\`

IMPORTANT RULES:
- Do NOT generate the framework JSON until you have asked enough questions to be confident it will be comprehensive and rigorous
- When you DO generate it, you MUST include the complete JSON block in the SAME response. NEVER say "hold on" or "please wait" — you cannot send follow-up messages. Everything must be in one response.
- When you DO generate it, include it in your message along with an explanation of what you've created and invite the user to review/refine
- CRITICAL: If you decide to generate the framework, you MUST output the full ```json block in this response. Do not defer it to a later message — there is no later message.
- If the user asks you to "suggest topics" or "what should I include", provide detailed suggestions with reasoning
- Each measure definition MUST be at least 50 words
- Each scoringGuidance entry MUST be at least 30 words
- Include evidenceKeywords for every measure (5-10 keywords each)
- Aim for 15-30 measures grouped into 4-7 categories unless the user specifies otherwise
- After generating, ask if the user wants to refine any measures, add categories, or adjust scope

QUALITY CHECKLIST (mention this to the user when appropriate):
- [ ] Topic description is 150+ words covering scope, evidence types, standards, and exclusions
- [ ] Each measure has a definition of 50+ words
- [ ] Each measure has specific scoringGuidance for yes/no/partial
- [ ] Measures are mutually exclusive (no overlap)
- [ ] Measures are collectively exhaustive (cover all aspects)
- [ ] Evidence keywords are provided for each measure
- [ ] All measures are answerable from public corporate disclosures
- [ ] Categories are logically grouped
- [ ] Search templates are targeted and effective

${currentDraft ? `\nCURRENT DRAFT STATE:\n${JSON.stringify(currentDraft, null, 2)}\n\nThe user may want to refine this draft. Help them improve it.` : ""}

${fileContext && fileContext.length > 0 ? `\nUPLOADED REFERENCE FILES:\nThe user has uploaded the following files to inform the framework design. Use their content to suggest relevant measures, categories, and scoring criteria.\n${fileContext.map((f: { filename: string; content: string }) => `\n--- FILE: ${f.filename} ---\n${f.content.slice(0, 50000)}\n--- END FILE ---`).join("\n")}` : ""}`;

    // Build the conversation for the LLM
    const conversationPrompt = messages.map((m: { role: string; content: string }) => 
      `${m.role === "user" ? "USER" : "ASSISTANT"}: ${m.content}`
    ).join("\n\n");

    const { text } = await completeWithFallback("deepseek", {
      system: systemPrompt,
      prompt: conversationPrompt,
      maxTokens: 32000,
    });

    // Check if the response contains a framework JSON
    let frameworkDraft = null;
    const jsonMatch = text.match(/```json\s*([\s\S]*?)```/);
    if (jsonMatch) {
      try {
        frameworkDraft = JSON.parse(jsonMatch[1].trim());
      } catch {}
    }

    res.json({
      message: text,
      frameworkDraft,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Legacy endpoint (kept for backward compat)
router.post("/draft", async (req: Request, res: Response) => {
  try {
    const { topicDescription, measureCount } = req.body;
    if (!topicDescription) return res.status(400).json({ error: "Topic description required" });

    const { completeWithFallback } = await import("../lib/ai-providers.js");
    const { text } = await completeWithFallback("deepseek", {
      system: "You are an ESG framework designer. Create assessment measures for corporate disclosure analysis.",
      prompt: `Design an assessment framework for the following topic:\n\n${topicDescription}\n\nCreate ${measureCount || 25} specific, measurable questions grouped into 4-6 categories. Each measure should be answerable as Yes/No from public corporate disclosures.\n\nReturn JSON:\n{\n  "name": "Framework Name",\n  "categories": [\n    {\n      "name": "Category Name",\n      "measures": [\n        {\n          "measureId": "1.1-short-slug",\n          "title": "Does the company...?",\n          "definition": "Detailed definition",\n          "scoringGuidance": {"yes": "Evidence of...", "no": "No evidence of..."}\n        }\n      ]\n    }\n  ]\n}`,
      json: true,
      maxTokens: 8000,
    });

    res.json(JSON.parse(text));
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
