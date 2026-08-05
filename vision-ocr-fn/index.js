import vision from "@google-cloud/vision";
import { Buffer } from "node:buffer";

/**
 * HTTP Cloud Function (2nd gen compatible).
 * Accepts JSON: { image: "data:image/jpeg;base64,...." }
 * or raw base64 (no prefix). Returns: { text: "recognized text" }
 */
export async function ocrHttp(req, res) {
  // CORS (allow your Shopify domain)
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Headers", "Content-Type");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).send("");

  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "POST only" });
    }

    let b64 = "";
    if (req.is("application/json")) {
      const { image } = req.body || {};
      if (!image) return res.status(400).json({ error: "Missing image" });
      b64 = String(image).replace(/^data:image\/\w+;base64,/, "");
    } else {
      return res.status(400).json({ error: "Send JSON: { image: dataURL }" });
    }

    const client = new vision.ImageAnnotatorClient(); // uses service account env
    const [result] = await client.textDetection({
      image: { content: Buffer.from(b64, "base64") },
    });
    const detections = result.textAnnotations || [];
    const text = detections.length ? detections[0].description : "";

    return res.json({ text: text || "" });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Vision OCR failed" });
  }
}
