import { BusinessLine } from "@prisma/client";

export function classifyBusinessLine(sheetName?: string | null, positionName?: string | null, forced?: BusinessLine | null) {
  if (forced) return forced;
  const text = `${sheetName || ""} ${positionName || ""}`;
  if (/音频|音频侧|ASR|语音|转写|听辨/i.test(text)) return BusinessLine.AUDIO;
  if (/视频|视频侧|Caption|GSB|SBS|镜头|图像/i.test(text)) return BusinessLine.VIDEO;
  return BusinessLine.UNCLASSIFIED;
}
