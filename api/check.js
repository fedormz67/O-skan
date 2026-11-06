// api/check.js
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({
      status: 'error',
      error_message: 'Метод не поддерживается. Используйте POST.'
    });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      status: 'error',
      error_message: 'Серверная ошибка: Не настроен GEMINI_API_KEY в переменных окружения.'
    });
  }

  try {
    const { image } = req.body || {};
    if (!image) {
      return res.status(400).json({
        status: 'error',
        error_message: 'Изображение не получено клиентом.'
      });
    }

    const base64Data = image.replace(/^data:image\/\w+;base64,/, '');

    const prompt = `
Ты — международный контролер IOF и старший картограф БФО (Белорусской федерации ориентирования).
Твоя задача — идентифицировать условный знак спортивного ориентирования по фото фрагмента карты или легенды КП.

БАЗА ЗНАНИЙ:
1. Международные стандарты IOF:
   - ISOM 2017-2 (лесные карты)
   - ISSprOM 2019-2 (спринтерские карты)
   - ISCD (символы легенд КП)
   - ISMTBOM (велокросс) и ISSkiOM (лыжи)
2. Специфика БФО (Беларусь):
   - Окопы, траншеи, ходы сообщения времен ВОВ
   - Артиллерийские капониры и блиндажи
   - Воронки от снарядов и авиабомб
   - Выворотки (корчи) с землей
   - Градации белорусских болот и заросших вырубок

КРИТИЧЕСКОЕ ПРАВИЛО СПРИНТА (ISSprOM 2019-2):
Если знак запрещен для преодоления в спринте:
- 520 Зона с запретом доступа (оливковый цвет / частная территория)
- 521 Здание (темно-серый / черный контур)
- 518 Непреодолимый забор / стена (двойные засечки или толстая линия)
- 201 Непреодолимый обрыв / скала
- 301 Непреодолимый водоем
- 709 Временная граница запрета / запретная полоса
- 410 Непроходимая растительность (темно-зеленый 100%)
В этом случае поле "is_sprint_disqualification" ОБЯЗАНО быть true!

ФОРМАТ ОТВЕТА (ТОЛЬКО ЧИСТЫЙ JSON, без кавычек \`\`\`json):
{
  "status": "exact" | "doubt" | "error",
  "error_message": "текст ошибки при status=error, иначе null",
  "doubt_reason": "краткий признак различия при status=doubt (1 предложение), иначе null",
  "symbols": [
    {
      "code_and_name": "Номер и официальное название (напр. '520. Зона с запретом доступа' или '112. Окоп ВОВ')",
      "standard": "ISOM 2017-2 | ISSprOM 2019-2 | ISCD | БФО",
      "terrain_description": "Что это на местности (1-2 емких предложения)",
      "passability": "Проходимость / преодоление (как бежать / ориентироваться)",
      "is_sprint_disqualification": true | false
    }
  ]
}

ЛОГИКА ОПРЕДЕЛЕНИЯ:
- Если уверен на 100%: status="exact", symbols содержит ровно 1 объект.
- Если фото спорное или знак допускает двоякое толкование: status="doubt", doubt_reason объясняет, на что атлету смотреть (толщина, шаг точек, оттенок), symbols содержит ровно 2 объекта-кандидата.
- Если фото смазано, не относится к карте, нет знака: status="error", symbols=[], error_message="❌ Знак не распознан. Сделайте четкий снимок без бликов".
`;

    // Вызов Gemini
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
            temperature: 0.15
          }
        })
      }
    );

    if (!response.ok) {
      const errBody = await response.text();
      console.error('Gemini API Error:', errBody);
      return res.status(response.status).json({
        status: 'error',
        error_message: 'Ошибка распознавания сервисом Gemini. Повторите попытку.'
      });
    }

    const data = await response.json();
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!rawText) {
      return res.status(500).json({
        status: 'error',
        error_message: 'Пустой ответ от нейросети.'
      });
    }

    const parsedResult = JSON.parse(rawText.trim());
    return res.status(200).json(parsedResult);

  } catch (error) {
    console.error('API Handler Error:', error);
    return res.status(500).json({
      status: 'error',
      error_message: 'Внутренняя ошибка сервера: ' + error.message
    });
  }
}
