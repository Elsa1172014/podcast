// يكتشف المتحدثين من السيناريو بصيغة "الاسم: الحوار" — سطر لكل جملة أو فقرة.
// يقبل النقطتين العربية أو اللاتينية، ومسافات متفاوتة حول الاسم.
export function parseScript(rawText) {
  const lines = rawText.split("\n").map((l) => l.trim()).filter(Boolean);
  const segments = [];
  const speakerNames = new Set();

  lines.forEach((line, i) => {
    // يطابق: "الاسم: النص" أو "الاسم : النص" — النقطتان عربية ٫ أو لاتينية :
    const match = line.match(/^([\u0600-\u06FFA-Za-z0-9\s]{2,30}?)\s*[:：]\s*(.+)$/);
    if (match) {
      const speaker = match[1].trim();
      const text = match[2].trim();
      speakerNames.add(speaker);
      segments.push({ speaker_name: speaker, text, order_index: i });
    } else {
      // سطر بلا متحدث محدَّد — يُلحق بنفس متحدث السطر السابق إن وُجد، وإلا يُتجاهل من الاكتشاف
      const prev = segments[segments.length - 1];
      if (prev) segments.push({ speaker_name: prev.speaker_name, text: line, order_index: i });
    }
  });

  return { segments, speakerNames: Array.from(speakerNames) };
}
