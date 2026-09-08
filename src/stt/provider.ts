/**
 * Nutqni matnga o'girish (STT) chegarasi.
 *
 * LLM bilan bir xil tamoyil: modullar aniq xizmat bilan emas, shu interfeys bilan
 * gaplashadi. Shuning uchun Whisper serverini almashtirish modul kodiga ta'sir qilmaydi.
 */

export type Transcript = {
  text: string;
  /** Model aniqlagan til (mavjud bo'lsa). */
  language?: string;
  durationSec?: number;
  provider: string;
};

export type SttProvider = {
  id: string;
  /** O'chirilgan bo'lsa modullar transkripsiyani o'tkazib yuboradi. */
  enabled: boolean;
  transcribe: (audio: Uint8Array, filename: string) => Promise<Transcript>;
};

/** HAMROH_STT=off bo'lganda ishlatiladi — chaqirilsa tushunarli yo'riqnoma beradi. */
export function disabledStt(): SttProvider {
  return {
    id: 'off',
    enabled: false,
    transcribe: () =>
      Promise.reject(
        new Error(
          [
            'Ovozni matnga o‘girish yoqilmagan (HAMROH_STT=off).',
            '',
            'Yoqish uchun Whisper serveri kerak. Eng oson yo‘l:',
            '  docker run -d --gpus all -p 8000:8000 fedirz/faster-whisper-server:latest-cuda',
            '',
            'Keyin .env ga:',
            '  HAMROH_STT=local',
            '  HAMROH_STT_URL=http://127.0.0.1:8000/v1',
            '  HAMROH_STT_MODEL=Systran/faster-whisper-large-v3',
            '',
            'Batafsil: docs/VOICE.md',
          ].join('\n'),
        ),
      ),
  };
}
