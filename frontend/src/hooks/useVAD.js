import { useRef, useCallback } from 'react';

export function useVAD({ onSpeechStart, onSpeechEnd }) {
  const vadRef = useRef(null);

  const destroyVAD = useCallback(async () => {
    if (vadRef.current) {
      try { 
        vadRef.current.pause(); 
        await vadRef.current.destroy?.(); 
      } catch (_) { }
      vadRef.current = null;
    }
  }, []);

  const initVAD = useCallback(async () => {
    await destroyVAD();
    const { MicVAD } = await import('@ricky0123/vad-web');

    if (window.ort && window.ort.env && window.ort.env.wasm) {
      window.ort.env.wasm.wasmPaths = '/';
    }

    const vad = await MicVAD.new({
      workletURL: '/vad.worklet.bundle.min.js',
      modelURL: '/silero_vad_v5.onnx',
      positiveSpeechThreshold: 0.8,
      negativeSpeechThreshold: 0.3,
      redemptionFrames: 8,
      onSpeechStart,
      onSpeechEnd,
    });
    
    vadRef.current = vad;
    vad.start();
  }, [destroyVAD, onSpeechStart, onSpeechEnd]);

  return { initVAD, destroyVAD, vadRef };
}
