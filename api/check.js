// api/check.js
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(200).json({
      status: 'error',
      error_message: 'Метод не поддерживается. Используйте POST.'
    });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(200).json({
      status: 'error',
      error_message: 'Серверная ошибка: Не найден GEMINI_API_KEY в Vercel.'
    });
  }

  try {
    const { image } = req.body || {};
    if (!image) {
      return res.status(200).json({
        status: 'error',
        error_message: 'Изображение не получено клиентом.'
      });
    }

    const base64Data = image.replace(/^data:image\/\w+;base64,/, '');

    const prompt = `
Ты — международный контролер IOF и старший картограф БФО (Белорусской федерации ориентирования).
Твоя задача — безошибочно определить условный знак спортивного ориентирования по фото карты.

### ПРАВИЛО 0: ПРИЦЕЛ-МИШЕНЬ (КРИТИЧНО!)
На изображении может быть нарисован яркий оранжевый круглый прицел-мишень (с точкой/перекрестием).
Если на карте есть прицел — ты ОБЯЗАН определить ИМЕННО ТОТ ЗНАК, который находится ВНУТРИ этого прицела! 
Игнорируй любые соседние объекты вокруг прицела (зеленку, соседние линии, тропы).

### ПРАВИЛО 1: ОПРЕДЕЛЕНИЕ ТИПА КАРТЫ
- ЛЕСНАЯ КАРТА (ISOM 2017-2): желтые поляны, белый лес, зеленые градации леса, коричневые линии рельефа.
  На лесных картах поле "is_sprint_disqualification" ВСЕГДА false! Дисквалификаций за преодоление болот или заборов в лесу НЕ БЫВАЕТ!
- СПРИНТЕРСКАЯ КАРТА (ISSprOM 2019-2): город, серые/коричневые здания, оливковый цвет дач/клумб, подпорные стенки.
  Только тут ставь "is_sprint_disqualification": true, если знак запрещен к преодолению (оливковый цвет, непреодолимая стена, пруд).

### ПРАВИЛО 2: ГИДРОГРАФИЯ (НЕ ПУТАТЬ БОЛОТО И ВОДОЕМ!)
- Знак 301 (Водоем, озеро, пруд): СПЛОШНАЯ 100% синяя заливка с черной береговой линией.
- Знак 307 / 308 (Непроходимое / проходимое болото): СИНЯЯ ГОРИЗОНТАЛЬНАЯ ШТРИХОВКА (полоски). Если видны полосы/штрихи — это БОЛОТО!
- Знак 310 (Заболоченность): прерывистые синие горизонтальные штрихи.

### ПРАВИЛО 3: СПЕЦИФИКА БФО (Беларусь)
Учитывай: окопы/траншеи ВОВ, воронки, капониры, выворотки (корчи) с землей, градации белорусских болот.

ФОРМАТ ОТВЕТА (ТОЛЬКО ЧИСТЫЙ JSON):
{
  "status": "exact" | "doubt" | "error",
  "error_message": null,
  "doubt_reason": "краткий признак различия при status=doubt (1 предложение), иначе null",
  "symbols": [
    {
      "code_and_name": "Номер и название (напр. '308. Болото проходимое')",
      "standard": "ISOM 2017-2 | ISSprOM 2019-2 | ISCD | БФО",
      "terrain_description": "Что это на местности (1-2 емких предложения)",
      "passability": "Проходимость / преодоление",
      "is_sprint_disqualification": false
    }
  ]
}
`;

    const response = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey.trim()
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: prompt },
                {
                  inline_data: {
                    mime_type: 'image/jpeg',
                    data: base64Data
                  }
                }
              ]
            }
          ],
          generationConfig: {
            response_mime_type: 'application/json',
            temperature: 0.1
          }
        })
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      console.error('Gemini Error:', errText);
      return res.status(200).json({
        status: 'error',
        error_message: `Ошибка Google API (${response.status}): Проверьте ключ или модель.`
      });
    }

    const data = await response.json();
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!rawText) {
      return res.status(200).json({
        status: 'error',
        error_message: 'Пустой ответ от нейросети.'
      });
    }

    const cleanJson = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
    const parsedResult = JSON.parse(cleanJson);
    return res.status(200).json(parsedResult);

  } catch (error) {
    console.error('API Error:', error);
    return res.status(200).json({
      status: 'error',
      error_message: 'Внутренняя ошибка: ' + error.message
    });
  }
}
