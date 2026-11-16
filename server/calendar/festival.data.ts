export type FestivalCategory = "NATIONAL" | "CULTURAL" | "REGIONAL";
export type FestivalRegion = "ALL" | "NORTH" | "SOUTH" | "WEST" | "EAST";
export type FestivalCommunity = "ALL" | "HINDU" | "SIKH" | "ISLAMIC" | "CHRISTIAN" | "JAIN" | "BUDDHIST" | "NATIONAL";
export type Language = "EN" | "HI" | "HINGLISH";

export interface MultilingualGreeting {
  en: { title: string; wish: string };
  hi: { title: string; wish: string };
  hinglish: { title: string; wish: string };
}

export interface FestivalTheme {
  primaryColor: string;
  secondaryColor: string;
  gradientBg: [string, string, string];
  accentColor: string;
  motif: "DIYA" | "FLAG" | "COLORS" | "STARS" | "PEACOCK" | "FLOWER";
}

export interface FestivalDefinition {
  id: string;
  name: string;
  nameHindi: string;
  category: FestivalCategory;
  community?: FestivalCommunity;
  region: FestivalRegion;
  theme: FestivalTheme;
  greetings: MultilingualGreeting;
  dates: Record<number, string>; // year -> YYYY-MM-DD
}

export const INDIAN_FESTIVALS: FestivalDefinition[] = [
  // ===================== JANUARY =====================
  {
    id: "new-year",
    name: "New Year's Day",
    nameHindi: "नव वर्ष दिवस",
    category: "CULTURAL",
    community: "ALL",
    region: "ALL",
    theme: {
      primaryColor: "#0284c7",
      secondaryColor: "#38bdf8",
      gradientBg: ["#0f172a", "#0284c7", "#38bdf8"],
      accentColor: "#38bdf8",
      motif: "STARS",
    },
    greetings: {
      en: { title: "Happy New Year", wish: "Wishing you a year filled with grand success, innovation, and unstoppable growth!" },
      hi: { title: "नव वर्ष की हार्दिक शुभकामनाएं", wish: "यह नया साल आपके जीवन और व्यापार में नई उमंग और सफलता लेकर आए।" },
      hinglish: { title: "Happy New Year", wish: "Naya saal, nayi shuruat! May this year bring extraordinary achievements to you and your team." },
    },
    dates: { 2025: "2025-01-01", 2026: "2026-01-01", 2027: "2027-01-01" },
  },
  {
    id: "guru-gobind-singh-jayanti",
    name: "Guru Gobind Singh Jayanti",
    nameHindi: "गुरु गोबिंद सिंह जयंती",
    category: "CULTURAL",
    community: "SIKH",
    region: "ALL",
    theme: {
      primaryColor: "#b45309",
      secondaryColor: "#f59e0b",
      gradientBg: ["#1c1917", "#b45309", "#f59e0b"],
      accentColor: "#f59e0b",
      motif: "STARS",
    },
    greetings: {
      en: { title: "Guru Gobind Singh Jayanti Greetings", wish: "May the divine teachings of courage, compassion, and righteousness guide you always." },
      hi: { title: "गुरु गोबिंद सिंह जयंती की लख-लख बधाइयां", wish: "सवा लाख से एक लड़ाऊं... दशमेश पिता श्री गुरु गोबिंद सिंह जी के पावन प्रकाश पर्व की शुभकामनाएं।" },
      hinglish: { title: "Happy Guru Gobind Singh Jayanti", wish: "Guru Gobind Singh Ji ka aashirwaad aapke saath rahe aur aap har chunauti ko paar karein." },
    },
    dates: { 2025: "2025-01-06", 2026: "2026-01-25", 2027: "2027-01-14" },
  },
  {
    id: "national-youth-day",
    name: "National Youth Day",
    nameHindi: "राष्ट्रीय युवा दिवस",
    category: "NATIONAL",
    community: "NATIONAL",
    region: "ALL",
    theme: {
      primaryColor: "#c2410c",
      secondaryColor: "#f97316",
      gradientBg: ["#0f172a", "#c2410c", "#f97316"],
      accentColor: "#f97316",
      motif: "STARS",
    },
    greetings: {
      en: { title: "Happy National Youth Day", wish: "Arise, awake, and stop not till the goal is reached. Honoring Swami Vivekananda's vision." },
      hi: { title: "राष्ट्रीय युवा दिवस की शुभकामनाएं", wish: "उठो, जागो और तब तक मत रुको जब तक लक्ष्य प्राप्त न हो जाए। स्वामी विवेकानंद जी को नमन।" },
      hinglish: { title: "Happy National Youth Day", wish: "Youth power is unstoppable. Let's dream big and lead the future with confidence." },
    },
    dates: { 2025: "2025-01-12", 2026: "2026-01-12", 2027: "2027-01-12" },
  },
  {
    id: "lohri",
    name: "Lohri",
    nameHindi: "लोहड़ी",
    category: "REGIONAL",
    community: "SIKH",
    region: "NORTH",
    theme: {
      primaryColor: "#9a3412",
      secondaryColor: "#fb923c",
      gradientBg: ["#18181b", "#9a3412", "#fb923c"],
      accentColor: "#ea580c",
      motif: "FLOWER",
    },
    greetings: {
      en: { title: "Happy Lohri", wish: "May the sacred bonfire of Lohri burn away all negativities and usher in immense joy and prosperity." },
      hi: { title: "लोहड़ी की लख-लख बधाइयां", wish: "लोहड़ी की पावन अग्नि आपके जीवन में खुशहाली, प्रेम और सौभाग्य लेकर आए।" },
      hinglish: { title: "Happy Lohri to All", wish: "Mungfali, til aur rewari ki mithas ke sath, Lohri ki dher saari shubhkaamnayein!" },
    },
    dates: { 2025: "2025-01-13", 2026: "2026-01-13", 2027: "2027-01-13" },
  },
  {
    id: "makar-sankranti",
    name: "Makar Sankranti / Pongal",
    nameHindi: "मकर संक्रांति / पोंगल",
    category: "CULTURAL",
    community: "HINDU",
    region: "ALL",
    theme: {
      primaryColor: "#d97706",
      secondaryColor: "#fbbf24",
      gradientBg: ["#0f172a", "#d97706", "#fbbf24"],
      accentColor: "#f59e0b",
      motif: "DIYA",
    },
    greetings: {
      en: { title: "Happy Makar Sankranti & Pongal", wish: "May your aspirations soar high like the kites and harvest bountiful prosperity for your venture." },
      hi: { title: "मकर संक्रांति एवं पोंगल की शुभकामनाएं", wish: "सूर्य देव का उत्तरायण आपके जीवन में नई ऊर्जा, उमंग और सफलता का संचार करे।" },
      hinglish: { title: "Happy Makar Sankranti & Pongal", wish: "Patangon ki udaan aur til-gur ki mithas ke sath aapke business ko nayi unchai milein!" },
    },
    dates: { 2025: "2025-01-14", 2026: "2026-01-14", 2027: "2027-01-15" },
  },
  {
    id: "netaji-subhas-jayanti",
    name: "Netaji Jayanti (Parakram Diwas)",
    nameHindi: "नेताजी सुभाष चंद्र बोस जयंती",
    category: "NATIONAL",
    community: "NATIONAL",
    region: "ALL",
    theme: {
      primaryColor: "#7c2d12",
      secondaryColor: "#f97316",
      gradientBg: ["#0f172a", "#7c2d12", "#f97316"],
      accentColor: "#ea580c",
      motif: "FLAG",
    },
    greetings: {
      en: { title: "Remembering Netaji Subhas Chandra Bose", wish: "Honoring the legendary leader whose supreme courage and patriotism inspire generations. Jai Hind!" },
      hi: { title: "पराक्रम दिवस पर नेताजी को नमन", wish: "तुम मुझे खून दो, मैं तुम्हें आज़ादी दूंगा। महान स्वतंत्रता सेनानी नेताजी को शत-शत नमन।" },
      hinglish: { title: "Salute to Netaji Subhas Chandra Bose", wish: "Supreme bravery, vision, and patriotism. Jai Hind, Jai Bharat!" },
    },
    dates: { 2025: "2025-01-23", 2026: "2026-01-23", 2027: "2027-01-23" },
  },
  {
    id: "vasant-panchami",
    name: "Vasant Panchami / Saraswati Puja",
    nameHindi: "बसंत पंचमी / सरस्वती पूजा",
    category: "CULTURAL",
    community: "HINDU",
    region: "ALL",
    theme: {
      primaryColor: "#ca8a04",
      secondaryColor: "#fde047",
      gradientBg: ["#1c1917", "#ca8a04", "#fde047"],
      accentColor: "#eab308",
      motif: "FLOWER",
    },
    greetings: {
      en: { title: "Happy Vasant Panchami", wish: "May Goddess Saraswati bless you with endless wisdom, creativity, and knowledge." },
      hi: { title: "बसंत पंचमी की हार्दिक शुभकामनाएं", wish: "मां सरस्वती की कृपा से आपके जीवन में ज्ञान, विद्या और कला का सदा वास रहे।" },
      hinglish: { title: "Happy Vasant Panchami & Saraswati Puja", wish: "Goddess Saraswati aapko wisdom aur creativity se aashirwad dein." },
    },
    dates: { 2025: "2025-02-02", 2026: "2026-01-23", 2027: "2027-02-11" },
  },
  {
    id: "republic-day",
    name: "Republic Day",
    nameHindi: "गणतंत्र दिवस",
    category: "NATIONAL",
    community: "NATIONAL",
    region: "ALL",
    theme: {
      primaryColor: "#FF9933",
      secondaryColor: "#138808",
      gradientBg: ["#0f172a", "#1e1b4b", "#064e3b"],
      accentColor: "#FF9933",
      motif: "FLAG",
    },
    greetings: {
      en: { title: "Happy Republic Day", wish: "Wishing you a proud & prosperous Republic Day. Let's build a stronger nation together. Jai Hind!" },
      hi: { title: "गणतंत्र दिवस की हार्दिक शुभकामनाएं", wish: "आइए मिलकर देश की प्रगति और समृद्धि में अपना योगदान दें। जय हिंद!" },
      hinglish: { title: "Happy Republic Day", wish: "Iss Republic Day par chalo milkar desh aur apne business ko nayi uchaiyon par le jayein. Jai Hind!" },
    },
    dates: { 2025: "2025-01-26", 2026: "2026-01-26", 2027: "2027-01-26" },
  },

  // ===================== FEBRUARY =====================
  {
    id: "maha-shivratri",
    name: "Maha Shivratri",
    nameHindi: "महाशिवरात्रि",
    category: "CULTURAL",
    community: "HINDU",
    region: "ALL",
    theme: {
      primaryColor: "#312e81",
      secondaryColor: "#6366f1",
      gradientBg: ["#09090b", "#312e81", "#6366f1"],
      accentColor: "#818cf8",
      motif: "DIYA",
    },
    greetings: {
      en: { title: "Happy Maha Shivratri", wish: "May Lord Shiva bestow upon you wisdom, strength, serenity, and inner peace. Har Har Mahadev!" },
      hi: { title: "महाशिवरात्रि की हार्दिक शुभकामनाएं", wish: "देवाधिदेव महादेव और मां पार्वती की कृपा आप और आपके परिवार पर सदा बनी रहे। हर हर महादेव!" },
      hinglish: { title: "Har Har Mahadev - Happy Maha Shivratri", wish: "Lord Shiva aapko har chunauti se ladne ki shakti aur dher saari shanti pradan karein." },
    },
    dates: { 2025: "2025-02-26", 2026: "2026-02-15", 2027: "2027-03-06" },
  },
  {
    id: "ramadan-start",
    name: "Ramadan Begins",
    nameHindi: "रमज़ान मुबारक (आरंभ)",
    category: "CULTURAL",
    community: "ISLAMIC",
    region: "ALL",
    theme: {
      primaryColor: "#065f46",
      secondaryColor: "#34d399",
      gradientBg: ["#022c22", "#065f46", "#34d399"],
      accentColor: "#10b981",
      motif: "STARS",
    },
    greetings: {
      en: { title: "Ramadan Mubarak", wish: "Wishing you a blessed month filled with devotion, peace, self-reflection, and prosperity." },
      hi: { title: "रमज़ान मुबारक", wish: "यह मुकद्दस महीना आपके जीवन में खुशहाली, बरकत और रहमत लेकर आए।" },
      hinglish: { title: "Ramadan Mubarak to You and Family", wish: "May this holy month bring lots of peace, health, and endless blessings." },
    },
    dates: { 2025: "2025-03-01", 2026: "2026-02-18", 2027: "2027-02-08" },
  },
  {
    id: "national-science-day",
    name: "National Science Day",
    nameHindi: "राष्ट्रीय विज्ञान दिवस",
    category: "NATIONAL",
    community: "NATIONAL",
    region: "ALL",
    theme: {
      primaryColor: "#0e7490",
      secondaryColor: "#22d3ee",
      gradientBg: ["#082f49", "#0e7490", "#22d3ee"],
      accentColor: "#06b6d4",
      motif: "STARS",
    },
    greetings: {
      en: { title: "Happy National Science Day", wish: "Celebrating the discovery of the Raman Effect and the relentless pursuit of scientific curiosity and innovation." },
      hi: { title: "राष्ट्रीय विज्ञान दिवस की शुभकामनाएं", wish: "सर सी.वी. रमन के ऐतिहासिक आविष्कार को नमन। विज्ञान और तकनीक से देश को समृद्ध बनाएं।" },
      hinglish: { title: "Happy National Science Day", wish: "Innovation, technology, and rational thinking drive the future. Let's build and invent!" },
    },
    dates: { 2025: "2025-02-28", 2026: "2026-02-28", 2027: "2027-02-28" },
  },

  // ===================== MARCH =====================
  {
    id: "holika-dahan",
    name: "Holika Dahan",
    nameHindi: "होलिका दहन",
    category: "CULTURAL",
    community: "HINDU",
    region: "ALL",
    theme: {
      primaryColor: "#9a3412",
      secondaryColor: "#f97316",
      gradientBg: ["#18181b", "#9a3412", "#f97316"],
      accentColor: "#f97316",
      motif: "DIYA",
    },
    greetings: {
      en: { title: "Holika Dahan Greetings", wish: "May the divine fire of Holika Dahan consume all negativity and illuminate your path with positivity and success." },
      hi: { title: "होलिका दहन की हार्दिक शुभकामनाएं", wish: "बुराई पर अच्छाई की विजय का यह पावन पर्व आपके जीवन में सुख और सकारात्मकता लाए।" },
      hinglish: { title: "Shubh Holika Dahan", wish: "Negative energy ka ant aur positivity ki nayi shuruat ho. Shubh Holika Dahan!" },
    },
    dates: { 2025: "2025-03-13", 2026: "2026-03-03", 2027: "2027-03-22" },
  },
  {
    id: "holi",
    name: "Holi",
    nameHindi: "होली",
    category: "CULTURAL",
    community: "HINDU",
    region: "ALL",
    theme: {
      primaryColor: "#FF1493",
      secondaryColor: "#FFD700",
      gradientBg: ["#831843", "#be185d", "#f43f5e"],
      accentColor: "#ec4899",
      motif: "COLORS",
    },
    greetings: {
      en: { title: "Happy Holi", wish: "May the vibrant colors of Holi bring joy, prosperity, and success to your personal and professional journey." },
      hi: { title: "होली की हार्दिक शुभकामनाएं", wish: "रंगों का यह पावन त्योहार आपके जीवन में खुशहाली और सफलता के नए रंग भरे।" },
      hinglish: { title: "Happy Holi", wish: "Iss Holi aapke business aur zindagi me rang bhar jayein. Khushiyon bhari Holi!" },
    },
    dates: { 2025: "2025-03-14", 2026: "2026-03-04", 2027: "2027-03-23" },
  },
  {
    id: "chaitra-navratri",
    name: "Chaitra Navratri / Gudi Padwa / Ugadi",
    nameHindi: "चैत्र नवरात्रि / गुड़ी पड़वा / उगादी",
    category: "CULTURAL",
    community: "HINDU",
    region: "ALL",
    theme: {
      primaryColor: "#b45309",
      secondaryColor: "#fbbf24",
      gradientBg: ["#451a03", "#b45309", "#fbbf24"],
      accentColor: "#f59e0b",
      motif: "FLOWER",
    },
    greetings: {
      en: { title: "Happy Chaitra Navratri & New Year", wish: "May the divine Mother bless you with power, purity, and abundant new beginnings this Hindu New Year." },
      hi: { title: "चैत्र नवरात्रि एवं नव संवत्सर की शुभकामनाएं", wish: "मां दुर्गा के नौ रूपों का आशीर्वाद आपके घर-परिवार और व्यापार पर सदा बना रहे।" },
      hinglish: { title: "Happy Chaitra Navratri, Gudi Padwa & Ugadi", wish: "Naye saal ki mangalmay shuruat ho. Maa Durga ka aashirwaad aap par barse!" },
    },
    dates: { 2025: "2025-03-30", 2026: "2026-03-19", 2027: "2027-04-07" },
  },
  {
    id: "eid-ul-fitr",
    name: "Eid-ul-Fitr",
    nameHindi: "ईद-उल-फ़ित्र",
    category: "CULTURAL",
    community: "ISLAMIC",
    region: "ALL",
    theme: {
      primaryColor: "#006400",
      secondaryColor: "#FFD700",
      gradientBg: ["#022c22", "#047857", "#34d399"],
      accentColor: "#10b981",
      motif: "STARS",
    },
    greetings: {
      en: { title: "Eid Mubarak", wish: "May this Eid bring peace, happiness, and prosperity to you and your family. Eid Mubarak!" },
      hi: { title: "ईद मुबारक", wish: "ईद का यह पावन पर्व आपके जीवन में सुख, शांति और समृद्धि लाए।" },
      hinglish: { title: "Eid Mubarak", wish: "Aapko aur aapke pariwar ko Eid Mubarak. Khushiyan aur barkat bani rahe." },
    },
    dates: { 2025: "2025-03-31", 2026: "2026-03-20", 2027: "2027-03-10" },
  },

  // ===================== APRIL =====================
  {
    id: "ram-navami",
    name: "Ram Navami",
    nameHindi: "रामनवमी",
    category: "CULTURAL",
    community: "HINDU",
    region: "ALL",
    theme: {
      primaryColor: "#d97706",
      secondaryColor: "#fde047",
      gradientBg: ["#451a03", "#d97706", "#fde047"],
      accentColor: "#f59e0b",
      motif: "DIYA",
    },
    greetings: {
      en: { title: "Happy Ram Navami", wish: "May the ideals of Maryada Purushottam Lord Rama inspire you towards righteousness, truth, and leadership." },
      hi: { title: "रामनवमी की हार्दिक शुभकामनाएं", wish: "प्रभु श्री राम का आशीर्वाद आपके जीवन में सुख, शांति, समृद्धि और मर्यादा स्थापित करे।" },
      hinglish: { title: "Shubh Ram Navami", wish: "Prabhu Shri Ram ke aashirwaad se aapka jeevan safalta aur satya ke marg par aage badhe. Jai Shri Ram!" },
    },
    dates: { 2025: "2025-04-06", 2026: "2026-03-27", 2027: "2027-04-15" },
  },
  {
    id: "mahavir-jayanti",
    name: "Mahavir Jayanti",
    nameHindi: "महावीर जयंती",
    category: "CULTURAL",
    community: "JAIN",
    region: "ALL",
    theme: {
      primaryColor: "#78350f",
      secondaryColor: "#fef08a",
      gradientBg: ["#1c1917", "#78350f", "#fef08a"],
      accentColor: "#fbbf24",
      motif: "FLOWER",
    },
    greetings: {
      en: { title: "Happy Mahavir Jayanti", wish: "Live and let live. May the noble principles of Ahimsa, truth, and compassion illuminate our world." },
      hi: { title: "महावीर जयंती की शुभकामनाएं", wish: "जियो और जीने दो। भगवान महावीर स्वामी के सत्य, अहिंसा और अपरिग्रह के संदेश को नमन।" },
      hinglish: { title: "Happy Mahavir Jayanti", wish: "May the teachings of peace and Ahimsa guide you in every step of life." },
    },
    dates: { 2025: "2025-04-10", 2026: "2026-03-31", 2027: "2027-04-19" },
  },
  {
    id: "good-friday",
    name: "Good Friday",
    nameHindi: "गुड फ्राइडे",
    category: "CULTURAL",
    community: "CHRISTIAN",
    region: "ALL",
    theme: {
      primaryColor: "#1e293b",
      secondaryColor: "#475569",
      gradientBg: ["#0f172a", "#1e293b", "#475569"],
      accentColor: "#94a3b8",
      motif: "STARS",
    },
    greetings: {
      en: { title: "Blessed Good Friday", wish: "May the solemn grace and supreme sacrifice of Jesus Christ bring forgiveness, healing, and peace to your life." },
      hi: { title: "गुड फ्राइडे की पावन मंगलकामनाएं", wish: "प्रभु यीशु का त्याग और असीम प्रेम हम सभी को करुणा और शांति का मार्ग दिखाए।" },
      hinglish: { title: "Have a Blessed Good Friday", wish: "Remembering the supreme sacrifice and boundless compassion of Christ." },
    },
    dates: { 2025: "2025-04-18", 2026: "2026-04-03", 2027: "2027-03-26" },
  },
  {
    id: "easter",
    name: "Easter Sunday",
    nameHindi: "ईस्टर संडे",
    category: "CULTURAL",
    community: "CHRISTIAN",
    region: "ALL",
    theme: {
      primaryColor: "#0284c7",
      secondaryColor: "#7dd3fc",
      gradientBg: ["#0c4a6e", "#0284c7", "#7dd3fc"],
      accentColor: "#38bdf8",
      motif: "STARS",
    },
    greetings: {
      en: { title: "Happy Easter", wish: "He is risen! May the resurrection of Christ bring renewed hope, faith, joy, and endless opportunities to your life." },
      hi: { title: "ईस्टर संडे की हार्दिक शुभकामनाएं", wish: "प्रभु यीशु के पुनरुत्थान का यह पावन दिन आपके जीवन में नई आशा और उमंग लेकर आए।" },
      hinglish: { title: "Happy Easter Sunday", wish: "Wishing you renewal, positivity, and boundless joy this Easter season." },
    },
    dates: { 2025: "2025-04-20", 2026: "2026-04-05", 2027: "2027-03-28" },
  },
  {
    id: "baisakhi",
    name: "Baisakhi",
    nameHindi: "बैसाखी",
    category: "CULTURAL",
    community: "SIKH",
    region: "ALL",
    theme: {
      primaryColor: "#b45309",
      secondaryColor: "#f59e0b",
      gradientBg: ["#1c1917", "#b45309", "#f59e0b"],
      accentColor: "#f59e0b",
      motif: "FLOWER",
    },
    greetings: {
      en: { title: "Happy Baisakhi", wish: "Celebrating the creation of the Khalsa and the joyous spring harvest. Prosperity and happiness to all!" },
      hi: { title: "बैसाखी की लख-लख बधाइयां", wish: "खालसा पंथ के स्थापना दिवस और बैसाखी के पावन पर्व पर आप सभी को बहुत-बहुत शुभकामनाएं।" },
      hinglish: { title: "Happy Baisakhi to All", wish: "Nayi fasal, nayi shuruaat aur Khalsa Panth ke garv ke sath... Happy Baisakhi!" },
    },
    dates: { 2025: "2025-04-14", 2026: "2026-04-14", 2027: "2027-04-14" },
  },
  {
    id: "ambedkar-jayanti",
    name: "Dr. B.R. Ambedkar Jayanti",
    nameHindi: "डॉ. बी.आर. अम्बेडकर जयंती",
    category: "NATIONAL",
    community: "NATIONAL",
    region: "ALL",
    theme: {
      primaryColor: "#1d4ed8",
      secondaryColor: "#60a5fa",
      gradientBg: ["#0f172a", "#1d4ed8", "#60a5fa"],
      accentColor: "#3b82f6",
      motif: "FLAG",
    },
    greetings: {
      en: { title: "Remembering Babasaheb Dr. B.R. Ambedkar", wish: "Educate, Agitate, Organise. Honoring the architect of the Indian Constitution on his birth anniversary." },
      hi: { title: "बाबासाहेब डॉ. अम्बेडकर जयंती पर कोटि-कोटि नमन", wish: "संविधान निर्माता, भारत रत्न बाबासाहेब डॉ. भीमराव अम्बेडकर जी को उनकी जयंती पर सादर नमन।" },
      hinglish: { title: "Salute to Babasaheb Ambedkar", wish: "Champion of equality, justice, and empowerment. Happy Ambedkar Jayanti!" },
    },
    dates: { 2025: "2025-04-14", 2026: "2026-04-14", 2027: "2027-04-14" },
  },

  // ===================== MAY & JUNE =====================
  {
    id: "buddha-purnima",
    name: "Buddha Purnima",
    nameHindi: "बुद्ध पूर्णिमा",
    category: "CULTURAL",
    community: "BUDDHIST",
    region: "ALL",
    theme: {
      primaryColor: "#0369a1",
      secondaryColor: "#bae6fd",
      gradientBg: ["#0f172a", "#0369a1", "#bae6fd"],
      accentColor: "#38bdf8",
      motif: "FLOWER",
    },
    greetings: {
      en: { title: "Happy Buddha Purnima", wish: "May the divine path of non-violence, mindfulness, and enlightenment bring calm and wisdom to your spirit." },
      hi: { title: "बुद्ध पूर्णिमा की शुभकामनाएं", wish: "बुद्धं शरणं गच्छामि... भगवान बुद्ध के शांति और करुणा के संदेश को अपने जीवन में अपनाएं।" },
      hinglish: { title: "Happy Buddha Purnima", wish: "Peace, compassion, and enlightenment in your thoughts and actions always." },
    },
    dates: { 2025: "2025-05-12", 2026: "2026-05-01", 2027: "2027-05-20" },
  },
  {
    id: "eid-al-adha",
    name: "Eid-al-Adha (Bakrid)",
    nameHindi: "ईद-उल-अज़हा (बकरीद)",
    category: "CULTURAL",
    community: "ISLAMIC",
    region: "ALL",
    theme: {
      primaryColor: "#047857",
      secondaryColor: "#6ee7b7",
      gradientBg: ["#022c22", "#047857", "#6ee7b7"],
      accentColor: "#059669",
      motif: "STARS",
    },
    greetings: {
      en: { title: "Eid-al-Adha Mubarak", wish: "May the noble spirit of sacrifice, faith, and devotion bring grace and peace to you and your loved ones." },
      hi: { title: "ईद-उल-अज़हा मुबारक", wish: "कुर्बानी और समर्पण का यह मुकद्दस पर्व आपके जीवन में खुशहाली और बरकत लाए।" },
      hinglish: { title: "Bakrid Mubarak to You", wish: "Eid-al-Adha ki dher saari mubarakbaad. May happiness and peace fill your days." },
    },
    dates: { 2025: "2025-06-07", 2026: "2026-05-27", 2027: "2027-05-16" },
  },
  {
    id: "international-yoga-day",
    name: "International Day of Yoga",
    nameHindi: "अंतर्राष्ट्रीय योग दिवस",
    category: "NATIONAL",
    community: "ALL",
    region: "ALL",
    theme: {
      primaryColor: "#0f766e",
      secondaryColor: "#2dd4bf",
      gradientBg: ["#022c22", "#0f766e", "#2dd4bf"],
      accentColor: "#10b981",
      motif: "FLOWER",
    },
    greetings: {
      en: { title: "Happy International Yoga Day", wish: "Harmonizing body, mind, and spirit. May yoga bring profound balance, agility, and peace into your life." },
      hi: { title: "अंतर्राष्ट्रीय योग दिवस की शुभकामनाएं", wish: "योग: कर्मसु कौशलम्... योग को अपने जीवन का हिस्सा बनाएं और स्वस्थ-सशक्त जीवन जिएं।" },
      hinglish: { title: "Happy International Yoga Day", wish: "Balance in body, calm in mind. Celebrate the ancient Indian gift to the world!" },
    },
    dates: { 2025: "2025-06-21", 2026: "2026-06-21", 2027: "2027-06-21" },
  },

  // ===================== AUGUST =====================
  {
    id: "independence-day",
    name: "Independence Day",
    nameHindi: "स्वतंत्रता दिवस",
    category: "NATIONAL",
    community: "NATIONAL",
    region: "ALL",
    theme: {
      primaryColor: "#FF9933",
      secondaryColor: "#138808",
      gradientBg: ["#0f172a", "#1e3a8a", "#064e3b"],
      accentColor: "#FF9933",
      motif: "FLAG",
    },
    greetings: {
      en: { title: "Happy Independence Day", wish: "Celebrating the spirit of freedom, innovation, and unity. Happy Independence Day! Jai Hind!" },
      hi: { title: "स्वतंत्रता दिवस की हार्दिक शुभकामनाएं", wish: "भारत की आजादी के पावन पर्व पर सभी देशवासियों को बधाई। जय हिंद, जय भारत!" },
      hinglish: { title: "Happy Independence Day", wish: "Desh ki azaadi aur unnati ka jashn manayein. Vande Mataram!" },
    },
    dates: { 2025: "2025-08-15", 2026: "2026-08-15", 2027: "2027-08-15" },
  },
  {
    id: "raksha-bandhan",
    name: "Raksha Bandhan",
    nameHindi: "रक्षाबंधन",
    category: "CULTURAL",
    community: "HINDU",
    region: "ALL",
    theme: {
      primaryColor: "#E11D48",
      secondaryColor: "#F59E0B",
      gradientBg: ["#831843", "#9d174d", "#f472b6"],
      accentColor: "#ec4899",
      motif: "DIYA",
    },
    greetings: {
      en: { title: "Happy Raksha Bandhan", wish: "Celebrating the eternal bond of love, protection, and cherished trust. Warm wishes on Rakhi!" },
      hi: { title: "रक्षाबंधन की हार्दिक शुभकामनाएं", wish: "भाई-बहन के अटूट प्रेम और विश्वास का यह पावन पर्व आपके जीवन में मिठास घोले।" },
      hinglish: { title: "Happy Raksha Bandhan", wish: "Bhai-behen ke pyare rishte ko celebrate karein. Have a wonderful Rakhi!" },
    },
    dates: { 2025: "2025-08-09", 2026: "2026-08-28", 2027: "2027-08-17" },
  },
  {
    id: "krishna-janmashtami",
    name: "Krishna Janmashtami",
    nameHindi: "कृष्ण जन्माष्टमी",
    category: "CULTURAL",
    community: "HINDU",
    region: "ALL",
    theme: {
      primaryColor: "#0284c7",
      secondaryColor: "#38bdf8",
      gradientBg: ["#082f49", "#0284c7", "#38bdf8"],
      accentColor: "#38bdf8",
      motif: "PEACOCK",
    },
    greetings: {
      en: { title: "Happy Krishna Janmashtami", wish: "May Lord Krishna steal your worries and bless you with divine wisdom, melody, and joy. Radhe Radhe!" },
      hi: { title: "श्री कृष्ण जन्माष्टमी की शुभकामनाएं", wish: "माखन चोर, नंद किशोर प्रभु श्री कृष्ण की कृपा आपके जीवन को खुशहाली और प्रेम से भर दे।" },
      hinglish: { title: "Happy Janmashtami - Radhe Radhe", wish: "Bhagwan Krishna ki bansuri ki dhun aapke jeevan me shanti aur safalta laye!" },
    },
    dates: { 2025: "2025-08-16", 2026: "2026-09-04", 2027: "2027-08-25" },
  },

  // ===================== SEPTEMBER & OCTOBER =====================
  {
    id: "teachers-day",
    name: "Teachers' Day",
    nameHindi: "शिक्षक दिवस",
    category: "NATIONAL",
    community: "NATIONAL",
    region: "ALL",
    theme: {
      primaryColor: "#4338ca",
      secondaryColor: "#a5b4fc",
      gradientBg: ["#1e1b4b", "#4338ca", "#a5b4fc"],
      accentColor: "#6366f1",
      motif: "STARS",
    },
    greetings: {
      en: { title: "Happy Teachers' Day", wish: "Deepest gratitude to all educators shaping our minds, values, and future. Happy Teachers' Day!" },
      hi: { title: "शिक्षक दिवस की हार्दिक शुभकामनाएं", wish: "हमारे जीवन को सही दिशा और संस्कार देने वाले सभी गुरुओं को सादर प्रणाम।" },
      hinglish: { title: "Thank You, Teachers!", wish: "To the mentors who believed in us and unlocked our potential... Happy Teachers' Day!" },
    },
    dates: { 2025: "2025-09-05", 2026: "2026-09-05", 2027: "2027-09-05" },
  },
  {
    id: "ganesh-chaturthi",
    name: "Ganesh Chaturthi",
    nameHindi: "गणेश चतुर्थी",
    category: "CULTURAL",
    community: "HINDU",
    region: "ALL",
    theme: {
      primaryColor: "#c2410c",
      secondaryColor: "#fb923c",
      gradientBg: ["#451a03", "#c2410c", "#fb923c"],
      accentColor: "#f97316",
      motif: "DIYA",
    },
    greetings: {
      en: { title: "Ganpati Bappa Morya", wish: "May Lord Ganesha remove all obstacles and bless your venture with intellect, wealth, and supreme victory." },
      hi: { title: "गणेश चतुर्थी की मंगलकामनाएं", wish: "विघ्नहर्ता भगवान श्री गणेश आपके जीवन के सभी विघ्न हर लें और सुख-समृद्धि का वरदान दें। गणपति बप्पा मोरया!" },
      hinglish: { title: "Ganpati Bappa Morya!", wish: "Vighnaharta Ganesh Ji aapke business aur parivar ko sukh-shanti aur safalta dein." },
    },
    dates: { 2025: "2025-08-27", 2026: "2026-09-14", 2027: "2027-09-04" },
  },
  {
    id: "gandhi-jayanti",
    name: "Gandhi & Shastri Jayanti",
    nameHindi: "गांधी एवं शास्त्री जयंती",
    category: "NATIONAL",
    community: "NATIONAL",
    region: "ALL",
    theme: {
      primaryColor: "#059669",
      secondaryColor: "#10B981",
      gradientBg: ["#0f172a", "#065f46", "#34d399"],
      accentColor: "#10b981",
      motif: "FLAG",
    },
    greetings: {
      en: { title: "Remembering Mahatma Gandhi & Lal Bahadur Shastri", wish: "Remembering the Father of the Nation and his enduring message of peace, truth, and resilience." },
      hi: { title: "गांधी जयंती पर शत-शत नमन", wish: "सत्य और अहिंसा के मार्ग पर चलकर राष्ट्र निर्माण का संकल्प लें। गांधी जयंती की शुभकामनाएं।" },
      hinglish: { title: "Remembering Mahatma Gandhi", wish: "Satya aur Ahimsa ke mulyon ko yaad karte hue, Gandhi Jayanti ki shubhkaamnayein." },
    },
    dates: { 2025: "2025-10-02", 2026: "2026-10-02", 2027: "2027-10-02" },
  },
  {
    id: "durga-puja",
    name: "Durga Puja (Maha Navami)",
    nameHindi: "दुर्गा पूजा (महानवमी)",
    category: "CULTURAL",
    community: "HINDU",
    region: "ALL",
    theme: {
      primaryColor: "#be123c",
      secondaryColor: "#fb7185",
      gradientBg: ["#4c0519", "#be123c", "#fb7185"],
      accentColor: "#e11d48",
      motif: "PEACOCK",
    },
    greetings: {
      en: { title: "Subho Sharodiya - Happy Durga Puja", wish: "May Mahishasuramardini Maa Durga eliminate all obstacles and illuminate your life with infinite joy." },
      hi: { title: "दुर्गा पूजा एवं महानवमी की शुभकामनाएं", wish: "मां दुर्गा का आशीर्वाद आपके जीवन को यश, कीर्ति और शांति से आलोकित करे। शुभो शारोदिया!" },
      hinglish: { title: "Subho Bijoya & Durga Puja Greetings", wish: "Dhaak ki beat aur Maa Durga ke aashirwaad ke sath... Happy Durga Puja!" },
    },
    dates: { 2025: "2025-10-01", 2026: "2026-10-19", 2027: "2027-10-09" },
  },
  {
    id: "dussehra",
    name: "Dussehra (Vijayadashami)",
    nameHindi: "दशहरा (विजयादशमी)",
    category: "CULTURAL",
    community: "HINDU",
    region: "ALL",
    theme: {
      primaryColor: "#c2410c",
      secondaryColor: "#f97316",
      gradientBg: ["#431407", "#c2410c", "#f97316"],
      accentColor: "#ea580c",
      motif: "DIYA",
    },
    greetings: {
      en: { title: "Happy Dussehra", wish: "May this Vijayadashami bring triumph over all obstacles and open the path to grand success." },
      hi: { title: "विजयादशमी की हार्दिक शुभकामनाएं", wish: "बुराई पर अच्छाई और असत्य पर सत्य की विजय का यह पावन पर्व आपके जीवन में नई रोशनी लाए।" },
      hinglish: { title: "Happy Dussehra", wish: "Burai par acchai ki jeet! May this Dussehra bring success and victory in all your goals." },
    },
    dates: { 2025: "2025-10-02", 2026: "2026-10-20", 2027: "2027-10-10" },
  },
  {
    id: "karwa-chauth",
    name: "Karwa Chauth",
    nameHindi: "करवा चौथ",
    category: "CULTURAL",
    community: "HINDU",
    region: "NORTH",
    theme: {
      primaryColor: "#9d174d",
      secondaryColor: "#f472b6",
      gradientBg: ["#500724", "#9d174d", "#f472b6"],
      accentColor: "#be185d",
      motif: "DIYA",
    },
    greetings: {
      en: { title: "Happy Karwa Chauth", wish: "Celebrating the sacred vows of eternal companionship, deep love, devotion, and longevity." },
      hi: { title: "करवा चौथ की हार्दिक शुभकामनाएं", wish: "चांद की चांदनी आपके वैवाहिक जीवन में प्रेम, विश्वास और अटूट मिठास घोले।" },
      hinglish: { title: "Happy Karwa Chauth", wish: "Wishing all fasting couples everlasting love, health, and togetherness." },
    },
    dates: { 2025: "2025-10-10", 2026: "2026-10-28", 2027: "2027-10-18" },
  },

  // ===================== NOVEMBER (ACTIVE IN SCREENSHOT) =====================
  {
    id: "dhanteras",
    name: "Dhanteras",
    nameHindi: "धनतेरस",
    category: "CULTURAL",
    community: "HINDU",
    region: "ALL",
    theme: {
      primaryColor: "#a16207",
      secondaryColor: "#facc15",
      gradientBg: ["#422006", "#a16207", "#facc15"],
      accentColor: "#eab308",
      motif: "DIYA",
    },
    greetings: {
      en: { title: "Happy Dhanteras", wish: "May Lord Dhanvantari and Goddess Lakshmi shower boundless wealth, radiant health, and grand prosperity upon you." },
      hi: { title: "धनतेरस की हार्दिक शुभकामनाएं", wish: "भगवान धन्वंतरि और मां लक्ष्मी की कृपा से आपका घर-आंगन धन, धान्य और उत्तम स्वास्थ्य से परिपूर्ण रहे।" },
      hinglish: { title: "Shubh Dhanteras to You & Family", wish: "Dhan aur swasthya ki varsha ho. May this Dhanteras mark golden growth for your business!" },
    },
    dates: { 2025: "2025-10-18", 2026: "2026-11-06", 2027: "2027-10-27" },
  },
  {
    id: "diwali",
    name: "Diwali (Deepawali & Lakshmi Puja)",
    nameHindi: "दीपावली / महालक्ष्मी पूजा",
    category: "CULTURAL",
    community: "HINDU",
    region: "ALL",
    theme: {
      primaryColor: "#FFD700",
      secondaryColor: "#FF4500",
      gradientBg: ["#1e1b4b", "#92400e", "#f59e0b"],
      accentColor: "#f59e0b",
      motif: "DIYA",
    },
    greetings: {
      en: { title: "Happy Diwali", wish: "May the festival of lights illuminate your life with joy, good health, and immense wealth. Happy Diwali!" },
      hi: { title: "दीपावली की हार्दिक शुभकामनाएं", wish: "दीपों का यह पावन पर्व आपके जीवन में सुख, शांति, समृद्धि और अपार खुशहाली लेकर आए।" },
      hinglish: { title: "Happy Diwali to You & Family", wish: "Maa Lakshmi ka aashirwaad aap par barse aur aapka business khoob grow kare. Shubh Deepawali!" },
    },
    dates: { 2025: "2025-10-20", 2026: "2026-11-08", 2027: "2027-10-29" },
  },
  {
    id: "bandi-chhor-divas",
    name: "Bandi Chhor Divas",
    nameHindi: "बंदी छोड़ दिवस",
    category: "CULTURAL",
    community: "SIKH",
    region: "ALL",
    theme: {
      primaryColor: "#b45309",
      secondaryColor: "#fbbf24",
      gradientBg: ["#1c1917", "#b45309", "#fbbf24"],
      accentColor: "#f59e0b",
      motif: "STARS",
    },
    greetings: {
      en: { title: "Bandi Chhor Divas Mubarak", wish: "Celebrating the historic release of Guru Hargobind Sahib Ji and 52 innocent kings. Freedom and justice to all!" },
      hi: { title: "बंदी छोड़ दिवस की लख-लख बधाइयां", wish: "छठे पातशाह श्री गुरु हरगोबिंद साहिब जी के बंदी छोड़ दिवस की समूह संगत को हार्दिक शुभकामनाएं।" },
      hinglish: { title: "Bandi Chhor Divas Greetings", wish: "True freedom, compassion, and justice. Lakh lakh vadhaiyan on Bandi Chhor Divas!" },
    },
    dates: { 2025: "2025-10-20", 2026: "2026-11-08", 2027: "2027-10-29" },
  },
  {
    id: "govardhan-puja",
    name: "Govardhan Puja / Annakut",
    nameHindi: "गोवर्धन पूजा / अन्नकूट",
    category: "CULTURAL",
    community: "HINDU",
    region: "ALL",
    theme: {
      primaryColor: "#065f46",
      secondaryColor: "#34d399",
      gradientBg: ["#022c22", "#065f46", "#34d399"],
      accentColor: "#10b981",
      motif: "FLOWER",
    },
    greetings: {
      en: { title: "Happy Govardhan Puja & Annakut", wish: "May Lord Krishna protect you from all storms of life and bestow upon you bountiful harvest and nourishment." },
      hi: { title: "गोवर्धन पूजा की हार्दिक शुभकामनाएं", wish: "भगवान श्री कृष्ण आपके जीवन में सुख, शांति, समृद्धि और प्रकृति का संतुलन बनाए रखें।" },
      hinglish: { title: "Happy Govardhan Puja to All", wish: "Prabhu Krishna ka aashirwaad aur prakriti ka samriddh aashirwaad aapko mile." },
    },
    dates: { 2025: "2025-10-22", 2026: "2026-11-09", 2027: "2027-10-30" },
  },
  {
    id: "bhai-dooj",
    name: "Bhai Dooj",
    nameHindi: "भाई दूज",
    category: "CULTURAL",
    community: "HINDU",
    region: "ALL",
    theme: {
      primaryColor: "#be123c",
      secondaryColor: "#fb7185",
      gradientBg: ["#4c0519", "#be123c", "#fb7185"],
      accentColor: "#f43f5e",
      motif: "DIYA",
    },
    greetings: {
      en: { title: "Happy Bhai Dooj", wish: "May the sacred affection and bond between brothers and sisters remain unbroken and blessed for lifetimes." },
      hi: { title: "भाई दूज की हार्दिक शुभकामनाएं", wish: "भाई-बहन के स्नेह, सम्मान और अटूट विश्वास का यह पावन पर्व आपके जीवन में मिठास घोले।" },
      hinglish: { title: "Happy Bhai Dooj", wish: "Bhai-behen ke pyare rishte ko celebrate karte hue, wishing you a happy and blessed Bhai Dooj!" },
    },
    dates: { 2025: "2025-10-23", 2026: "2026-11-10", 2027: "2027-10-31" },
  },
  {
    id: "childrens-day",
    name: "Children's Day (Bal Diwas)",
    nameHindi: "बाल दिवस",
    category: "NATIONAL",
    community: "NATIONAL",
    region: "ALL",
    theme: {
      primaryColor: "#0e7490",
      secondaryColor: "#38bdf8",
      gradientBg: ["#083344", "#0e7490", "#38bdf8"],
      accentColor: "#06b6d4",
      motif: "STARS",
    },
    greetings: {
      en: { title: "Happy Children's Day", wish: "Children are like buds in a garden. Nurturing future leaders, innovators, and dreamers with love and care." },
      hi: { title: "बाल दिवस की हार्दिक शुभकामनाएं", wish: "चाचा नेहरू की जयंती पर सभी बच्चों को ढेर सारा प्यार। बच्चे ही हमारे देश का उज्ज्वल भविष्य हैं।" },
      hinglish: { title: "Happy Children's Day", wish: "Keep the inner child alive! Nurturing young minds with creativity and curiosity." },
    },
    dates: { 2025: "2025-11-14", 2026: "2026-11-14", 2027: "2027-11-14" },
  },
  {
    id: "chhath-puja",
    name: "Chhath Puja (Maha Parv)",
    nameHindi: "छठ पूजा (महापर्व)",
    category: "CULTURAL",
    community: "HINDU",
    region: "ALL",
    theme: {
      primaryColor: "#c2410c",
      secondaryColor: "#fbbf24",
      gradientBg: ["#431407", "#c2410c", "#fbbf24"],
      accentColor: "#f97316",
      motif: "DIYA",
    },
    greetings: {
      en: { title: "Happy Chhath Puja", wish: "Saluting Lord Surya and Chhathi Maiya. May the sacred arghya bring longevity, purity, health, and supreme vitality." },
      hi: { title: "लोक आस्था के महापर्व छठ पूजा की शुभकामनाएं", wish: "भगवान भास्कर और छठी मइया की कृपा से आपके घर-परिवार में सुख, शांति, समृद्धि और उत्तम स्वास्थ्य रहे।" },
      hinglish: { title: "Jai Chhathi Maiya - Shubh Chhath", wish: "Lord Surya aur Chhathi Maiya ka aashirwaad aapke parivar par sada bana rahe!" },
    },
    dates: { 2025: "2025-10-27", 2026: "2026-11-15", 2027: "2027-11-04" },
  },
  {
    id: "guru-nanak-jayanti",
    name: "Guru Nanak Jayanti (Gurpurab)",
    nameHindi: "गुरु नानक देव जी प्रकाश पर्व (गुरपुरब)",
    category: "CULTURAL",
    community: "SIKH",
    region: "ALL",
    theme: {
      primaryColor: "#b45309",
      secondaryColor: "#fbbf24",
      gradientBg: ["#1c1917", "#b45309", "#fbbf24"],
      accentColor: "#f59e0b",
      motif: "STARS",
    },
    greetings: {
      en: { title: "Happy Gurpurab - Guru Nanak Jayanti", wish: "Kirat Karo, Naam Japo, Wand Chhako. May the divine teachings of universal brotherhood and truth enlighten you." },
      hi: { title: "गुरु नानक जयंती की लख-लख बधाइयां", wish: "श्री गुरु नानक देव जी के प्रकाश पर्व पर आप सभी को शुभकामनाएं। वाहेगुरु जी का खालसा, वाहेगुरु जी की फतेह!" },
      hinglish: { title: "Gurpurab Diyan Lakh Lakh Vadhaiyan", wish: "May Guru Nanak Dev Ji inspire you with truth, humility, and selfless service." },
    },
    dates: { 2025: "2025-11-05", 2026: "2026-11-24", 2027: "2027-11-13" },
  },
  {
    id: "dev-deepawali",
    name: "Dev Deepawali & Kartik Purnima",
    nameHindi: "देव दीपावली / कार्तिक पूर्णिमा",
    category: "CULTURAL",
    community: "HINDU",
    region: "ALL",
    theme: {
      primaryColor: "#78350f",
      secondaryColor: "#facc15",
      gradientBg: ["#1e1b4b", "#78350f", "#facc15"],
      accentColor: "#fbbf24",
      motif: "DIYA",
    },
    greetings: {
      en: { title: "Happy Dev Deepawali", wish: "May millions of glowing diyas on the ghats of Kashi illuminate your spirit with divine grace and fortune." },
      hi: { title: "देव दीपावली एवं कार्तिक पूर्णिमा की शुभकामनाएं", wish: "काशी के पावन घाटों की तरह आपका जीवन भी भक्ति, ज्ञान और सफलता के दीपों से जगमगाता रहे।" },
      hinglish: { title: "Shubh Dev Deepawali to All", wish: "Ganga ghaton ki tarah aapka jeevan bhi divya roshni se bhar jaye!" },
    },
    dates: { 2025: "2025-11-05", 2026: "2026-11-24", 2027: "2027-11-13" },
  },
  {
    id: "constitution-day",
    name: "Samvidhan Divas (Constitution Day)",
    nameHindi: "संविधान दिवस",
    category: "NATIONAL",
    community: "NATIONAL",
    region: "ALL",
    theme: {
      primaryColor: "#1d4ed8",
      secondaryColor: "#93c5fd",
      gradientBg: ["#0f172a", "#1d4ed8", "#93c5fd"],
      accentColor: "#3b82f6",
      motif: "FLAG",
    },
    greetings: {
      en: { title: "Happy Constitution Day", wish: "Upholding justice, liberty, equality, and fraternity. Honoring the visionary founders of our democratic Republic." },
      hi: { title: "संविधान दिवस की हार्दिक शुभकामनाएं", wish: "हम, भारत के लोग... भारतीय संविधान के मूल्यों और सिद्धांतों को समर्पित राष्ट्रीय पर्व की बधाई।" },
      hinglish: { title: "Happy Samvidhan Divas", wish: "Proud of the world's greatest democratic constitution. Let's uphold its noble ideals!" },
    },
    dates: { 2025: "2025-11-26", 2026: "2026-11-26", 2027: "2027-11-26" },
  },

  // ===================== DECEMBER =====================
  {
    id: "christmas",
    name: "Christmas",
    nameHindi: "क्रिसमस",
    category: "CULTURAL",
    community: "CHRISTIAN",
    region: "ALL",
    theme: {
      primaryColor: "#DC2626",
      secondaryColor: "#16A34A",
      gradientBg: ["#14532d", "#831843", "#ef4444"],
      accentColor: "#10b981",
      motif: "STARS",
    },
    greetings: {
      en: { title: "Merry Christmas", wish: "May the joy and blessings of Christmas fill your home with warmth, love, and happiness." },
      hi: { title: "क्रिसमस की हार्दिक शुभकामनाएं", wish: "यह पावन पर्व आपके जीवन में खुशहाली, शांति और प्रेम की नई रोशनी लेकर आए।" },
      hinglish: { title: "Merry Christmas to All", wish: "Wishing you a joyful and blessed Christmas with your family and loved ones!" },
    },
    dates: { 2025: "2025-12-25", 2026: "2026-12-25", 2027: "2027-12-25" },
  },
  {
    id: "new-years-eve",
    name: "New Year's Eve",
    nameHindi: "नव वर्ष की पूर्व संध्या",
    category: "CULTURAL",
    community: "ALL",
    region: "ALL",
    theme: {
      primaryColor: "#6b21a8",
      secondaryColor: "#c084fc",
      gradientBg: ["#1e1b4b", "#6b21a8", "#c084fc"],
      accentColor: "#a855f7",
      motif: "STARS",
    },
    greetings: {
      en: { title: "Happy New Year's Eve", wish: "Cheers to the lessons of the past year and toast to the boundless triumphs awaiting us ahead!" },
      hi: { title: "नव वर्ष की पूर्व संध्या की बधाई", wish: "बीते वर्ष की खूबसूरत यादों और आने वाले साल के नए सपनों का स्वागत करें।" },
      hinglish: { title: "Cheers to the New Year!", wish: "Get ready to welcome another year of breakthrough growth, happiness, and success!" },
    },
    dates: { 2025: "2025-12-31", 2026: "2026-12-31", 2027: "2027-12-31" },
  },
];

export function getFestivalById(id: string): FestivalDefinition | undefined {
  return INDIAN_FESTIVALS.find((f) => f.id === id);
}

export function listFestivalsForYear(
  year: number,
  options?: { region?: FestivalRegion; category?: FestivalCategory; community?: FestivalCommunity },
): Array<FestivalDefinition & { dateForYear: string }> {
  return INDIAN_FESTIVALS.filter((f) => {
    if (!f.dates[year]) return false;
    if (options?.region && options.region !== "ALL" && f.region !== "ALL" && f.region !== options.region)
      return false;
    if (options?.category && f.category !== options.category) return false;
    if (options?.community && options.community !== "ALL" && f.community && f.community !== options.community)
      return false;
    return true;
  })
    .map((f) => ({
      ...f,
      dateForYear: f.dates[year],
    }))
    .sort((a, b) => a.dateForYear.localeCompare(b.dateForYear));
}
