import { NextResponse } from 'next/server';

export async function GET() {
  const diagnostic: Record<string, any> = {
    canvasLoaded: false,
    pdfjsLoaded: false,
    error: null,
    pdfjsError: null
  };

  try {
    const { createCanvas } = require('@napi-rs/canvas');
    const canvas = createCanvas(100, 100);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'red';
    ctx.fillRect(0, 0, 100, 100);
    const buf = canvas.toBuffer('image/png');
    diagnostic.canvasLoaded = true;
    diagnostic.bufferLength = buf.length;
  } catch (err: any) {
    diagnostic.error = err.message || String(err);
    diagnostic.stack = err.stack;
  }

  try {
    if (typeof (global as any).DOMMatrix === 'undefined') {
      (global as any).DOMMatrix = class {};
    }
    const pdfjs = require('pdfjs-dist/legacy/build/pdf.mjs');
    diagnostic.pdfjsLoaded = !!pdfjs;
  } catch (err: any) {
    diagnostic.pdfjsError = err.message || String(err);
  }

  return NextResponse.json(diagnostic);
}
