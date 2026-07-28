// Lightweight i18n for the customer-facing (shopper) flow. The shopper's language
// is detected once from their browser locale — Polish browsers get Polish, everyone
// else gets English. This keeps the embed experience native for a Polish store's
// customers without a heavy i18n framework. (A per-merchant locale override can be
// layered on later via the embed / shop settings.)

export type Lang = "en" | "pl";

export function detectLang(): Lang {
  if (typeof navigator !== "undefined") {
    const l = (navigator.language || "").toLowerCase();
    if (l.startsWith("pl")) return "pl";
  }
  return "en";
}

const en = {
  // Capture screen
  photographRoom:     "Photograph your room",
  pointHint:          "Point where you'd like the furniture. Any existing piece of the same type is replaced automatically — no need to clear the room first.",
  naturalLight:       "Natural lighting gives the best results",
  chooseGallery:      "Choose from gallery",
  takePhoto:          "Take photo",
  // Desktop QR / upload
  usePhoneScan:       "Use your phone — just scan the code below",
  scanToOpen:         "Scan to open camera on phone",
  photoReceived:      "Photo received — processing…",
  scanWithPhone:      "Scan with your phone",
  opensCamera:        "Opens the camera directly on your device",
  orUpload:           "or upload from this device",
  uploadRoomPhoto:    "Upload a room photo",
  jpgPng:             "JPG or PNG — natural lighting works best",
  // Processing
  placingProduct:     "Placing the product in your room…",
  usually2030:        "Usually 20–30 seconds",
  sendingPhoto:       "Sending photo…",
  uploadingServer:    "Uploading to server",
  // Errors
  somethingWrong:     "Something went wrong",
  tryAgain:           "Try again",
  back:               "Back",
  quotaExhausted:     "You've used all your Gen Points for this period. Please upgrade your plan to continue generating.",
  storeQuotaExhausted:"This store has used all its Gen Points for this period.",
  oops:               "Oops",
  close:              "Close",
  // Result
  resultLabel:        "Result",
  inYourRoom:         "in your room",           // used as `${productName} ${inYourRoom}`
  heresRoom:          "Here's your room ✨",
  retry:              "Retry",
  download:           "Download",
  share:              "Share",
  tryAnother:         "Try another",
  regenerate:         "Regenerate",
  regenFree:          "Not quite right? Try one more, on us.",
  regenAgain:         "Result looks unrealistic? Try again with a new generation.",
  fix:                "Fix",
  fixing:             "Refining…",
  straighten:         "Straighten",
  fixFloor:           "Fix floor",
  fixHint:            "Not quite right? Straighten the furniture or fix the floor.",
  poweredBy:          "Powered by",             // `${poweredBy} Furora & Gemini AI`
};

type Keys = keyof typeof en;

const pl: Record<Keys, string> = {
  photographRoom:     "Sfotografuj swój pokój",
  pointHint:          "Wskaż miejsce, w którym chcesz ustawić mebel. Istniejący mebel tego samego typu zostanie automatycznie zastąpiony — nie musisz nic przestawiać.",
  naturalLight:       "Naturalne światło daje najlepszy efekt",
  chooseGallery:      "Wybierz z galerii",
  takePhoto:          "Zrób zdjęcie",
  usePhoneScan:       "Użyj telefonu — zeskanuj kod poniżej",
  scanToOpen:         "Zeskanuj, aby otworzyć aparat w telefonie",
  photoReceived:      "Zdjęcie odebrane — przetwarzanie…",
  scanWithPhone:      "Zeskanuj telefonem",
  opensCamera:        "Otwiera aparat bezpośrednio na Twoim urządzeniu",
  orUpload:           "lub prześlij z tego urządzenia",
  uploadRoomPhoto:    "Prześlij zdjęcie pokoju",
  jpgPng:             "JPG lub PNG — najlepiej przy naturalnym świetle",
  placingProduct:     "Umieszczam mebel w Twoim pokoju…",
  usually2030:        "Zwykle 20–30 sekund",
  sendingPhoto:       "Wysyłam zdjęcie…",
  uploadingServer:    "Przesyłanie na serwer",
  somethingWrong:     "Coś poszło nie tak",
  tryAgain:           "Spróbuj ponownie",
  back:               "Wstecz",
  quotaExhausted:     "Wykorzystano wszystkie punkty generowania w tym okresie. Aby kontynuować, ulepsz plan.",
  storeQuotaExhausted:"Ten sklep wykorzystał wszystkie punkty generowania w tym okresie.",
  oops:               "Ups",
  close:              "Zamknij",
  resultLabel:        "Wynik",
  inYourRoom:         "w Twoim pokoju",
  heresRoom:          "Oto Twój pokój ✨",
  retry:              "Od nowa",
  download:           "Pobierz",
  share:              "Udostępnij",
  tryAnother:         "Inne zdjęcie",
  regenerate:         "Generuj ponownie",
  regenFree:          "Nie do końca tak? Spróbuj jeszcze raz — na nasz koszt.",
  regenAgain:         "Wynik wygląda nierealistycznie? Spróbuj wygenerować ponownie.",
  fix:                "Popraw",
  fixing:             "Poprawiam…",
  straighten:         "Wyprostuj",
  fixFloor:           "Popraw podłogę",
  fixHint:            "Nie do końca tak? Wyprostuj mebel lub popraw podłogę.",
  poweredBy:          "Obsługiwane przez",
};

export const lang = detectLang();
const table = lang === "pl" ? pl : en;

/** Translate a key into the shopper's detected language. */
export function t(key: Keys): string {
  return table[key] ?? en[key] ?? key;
}
