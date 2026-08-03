import type { BusinessLine } from "../types/businessLine";

export const businessLineConfigs: Record<BusinessLine, {
  title: string; shortName: string; levelLabel: string; screeningTitle: string; featureFields: string[];
}> = {
  VIDEO: { title: "视频招聘", shortName: "视频", levelLabel: "视频定级", screeningTitle: "视频简历筛选", featureFields: ["Caption经验", "视频评测经验", "GSB/SBS经验", "镜头语言理解", "视频内容理解"] },
  AUDIO: { title: "音频招聘", shortName: "音频", levelLabel: "音频定级", screeningTitle: "音频简历筛选", featureFields: ["普通话等级", "ASR标注经验", "音频听辨能力", "方言能力", "音频转写经验"] },
};
