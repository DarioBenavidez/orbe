'use strict';

const Anthropic = require('@anthropic-ai/sdk');
const Groq = require('groq-sdk');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const groq = process.env.GROQ_API_KEY ? new Groq({ apiKey: process.env.GROQ_API_KEY }) : null;

const PHONE_NUMBER_ID  = process.env.PHONE_NUMBER_ID;
const WHATSAPP_TOKEN   = process.env.WHATSAPP_TOKEN;

// ── Enviar mensaje de texto ───────────────────────────────
async function sendWhatsAppMessage(to, body, { throwOnError = false } = {}) {
  // WhatsApp API tiene límite de 4096 chars — truncar si es necesario
  if (typeof body === 'string' && body.length > 4000) {
    body = body.slice(0, 3950) + '\n\n_(mensaje muy largo, continuá preguntándome si necesitás más)_';
  }
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
      console.error(`❌ Error WhatsApp [to:${to}] status:${response.status}:`, JSON.stringify(result));
      if (throwOnError) throw new Error(result?.error?.message || 'Error enviando mensaje de WhatsApp');
    } else {
      console.log(`✅ WhatsApp enviado [to:***${to.slice(-4)}] msgId:${result?.messages?.[0]?.id}`);
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
  const MAX_AUDIO_BYTES = 150 * 1024; // 150KB ≈ 10 segundos de nota de voz (Opus)
  // Verificar Content-Length ANTES de bajar el archivo para no cargar archivos grandes en RAM
  const contentLength = parseInt(audioRes.headers.get('content-length') || '0', 10);
  if (contentLength > MAX_AUDIO_BYTES) throw new Error('audio_demasiado_largo');
  const buffer = Buffer.from(await audioRes.arrayBuffer());
  if (buffer.length > MAX_AUDIO_BYTES) throw new Error('audio_demasiado_largo');

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

module.exports = {
  anthropic,
  sendWhatsAppMessage,
  transcribeWhatsAppAudio,
};
