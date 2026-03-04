import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import detector from "i18next-browser-languagedetector";

import idCommon from "./locales/id/common.json";
import enCommon from "./locales/en/common.json";

i18n
  .use(detector)
  .use(initReactI18next)
  .init({
    resources: {
      id: {
        common: idCommon,
      },
      en: {
        common: enCommon,
      },
    },
    lng: "id",
    fallbackLng: "id",
    ns: ["common"],
    defaultNS: "common",
    nsSeparator: ".",
    keySeparator: ".",
    interpolation: {
      escapeValue: false,
    },
    detection: {
      order: ["localStorage", "navigator"],
      caches: ["localStorage"],
      lookupLocalStorage: "i18nextLng",
    },
  });

export default i18n;