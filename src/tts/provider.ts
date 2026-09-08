/** Matnni ovozga aylantirish (TTS) chegarasi. */

export type Speech = {
  /** Audio baytlari. */
  bytes: Uint8Array;
  /** Fayl kengaytmasi: ogg | mp3 | wav */
  ext: string;
  provider: string;
};

export type TtsProvider = {
  id: string;
  enabled: boolean;
  speak: (text: string) => Promise<Speech>;
};

export function disabledTts(): TtsProvider {
  return {
    id: 'off',
    enabled: false,
    speak: () =>
      Promise.reject(
        new Error(
          [
            'Ovozli javob yoqilmagan (HAMROH_TTS=off).',
            '',
            'Ikki yo‘l bor:',
            '  1) HTTP server (OpenAI-mos /audio/speech):',
            '       HAMROH_TTS=http',
            '       HAMROH_TTS_URL=http://127.0.0.1:8000/v1',
            '       HAMROH_TTS_VOICE=uz',
            '  2) Istalgan dastur (Piper, MMS-TTS skripti va h.k.):',
            '       HAMROH_TTS=cmd',
            '       HAMROH_TTS_CMD=piper -m uz.onnx -f {out}',
            '',
            'O‘zbekcha ovoz haqida: docs/VOICE.md',
          ].join('\n'),
        ),
      ),
  };
}
