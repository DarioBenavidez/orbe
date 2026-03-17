'use strict';

const Anthropic = require('@anthropic-ai/sdk');
const Groq = require('groq-sdk');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const groq = process.env.GROQ_API_KEY ? new Groq({ apiKey: process.env.GROQ_API_KEY }) : null;

const PHONE_NUMBER_ID  = process.env.PHONE_NUMBER_ID;
const WHATSAPP_TOKEN   = process.env.WHATSAPP_TOKEN;

// ── Enviar mensaje de texto ───────────────────────────────
async function sendWhatsAppMessage(to, body, { throwOnError = false } = {}) {
  try {
    const response = await fetch(`https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body },
      }),
    });
    const result = await response.json();
    if (!response.ok) {
      console.error('❌ Error WhatsApp:', JSON.stringify(result));
      if (throwOnError) throw new Error(result?.error?.message || 'Error enviando mensaje de WhatsApp');
    }
    return result;
  } catch (err) {
    console.error('❌ Error sendWhatsAppMessage:', err.message);
    if (throwOnError) throw err;
  }
}

// ── Transcribir audio con Groq Whisper ────────────────────
async function transcribeWhatsAppAudio(mediaId, mimeType) {
  const metaRes = await fetch(`https://graph.facebook.com/v22.0/${mediaId}`, {
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` },
  });
  if (!metaRes.ok) throw new Error(`Error obteniendo media URL: ${metaRes.status}`);
  const { url } = await metaRes.json();

  const audioRes = await fetch(url, {
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` },
  });
  if (!audioRes.ok) throw new Error(`Error descargando audio: ${audioRes.status}`);
  const buffer = Buffer.from(await audioRes.arrayBuffer());

  const ext = mimeType?.includes('ogg') ? 'ogg' : mimeType?.includes('mp4') ? 'mp4' : 'ogg';
  const file = new File([buffer], `audio.${ext}`, { type: mimeType || 'audio/ogg' });
  const transcription = await groq.audio.transcriptions.create({
    file,
    model: 'whisper-large-v3-turbo',
    language: 'es',
    response_format: 'text',
  });
  return typeof transcription === 'string' ? transcription.trim() : transcription?.text?.trim() || '';
}

// ── Descargar imagen de WhatsApp ──────────────────────────
async function downloadWhatsAppImage(mediaId) {
  const metaRes = await fetch(`https://graph.facebook.com/v22.0/${mediaId}`, {
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` },
  });
  if (!metaRes.ok) throw new Error(`Error obteniendo media URL: ${metaRes.status}`);
  const { url, mime_type } = await metaRes.json();

  const imgRes = await fetch(url, {
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` },
  });
  if (!imgRes.ok) throw new Error(`Error descargando imagen: ${imgRes.status}`);
  const buffer = await imgRes.arrayBuffer();
  const base64 = Buffer.from(buffer).toString('base64');
  return { base64, mimeType: mime_type || 'image/jpeg' };
}

// ── Claude con imagen (visión) ────────────────────────────
async function callClaudeWithImage(systemPrompt, base64Image, mimeType, textPrompt) {
  const response = await anthropic.messages.create({
    model: process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5',
    max_tokens: 800,
    system: systemPrompt,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64Image } },
        { type: 'text', text: textPrompt },
      ],
    }],
  });
  const text = response.content?.[0]?.text;
  if (!text) throw new Error('Claude devolvió respuesta vacía');
  return text.trim();
}

module.exports = {
  anthropic,
  sendWhatsAppMessage,
  transcribeWhatsAppAudio,
  downloadWhatsAppImage,
  callClaudeWithImage,
};
