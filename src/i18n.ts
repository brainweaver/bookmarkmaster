type LocaleCode = "en" | "es";

const messages = {
  en: {
    themeSwitchTooltip: "Switch color theme ({theme})",
    collapseTabsTooltip: "Collapse tabs to bookmarks",
    expandSelectedTooltip: "Expand selected tag links",
    searchPlaceholder: "Search… or #tag",
    tileView: "Tile view",
    tableView: "Table view",
    previewView: "Preview view",
    groupByDate: "Group by date",
    sortOrder: "Sort order",
    dateAdded: "Date Added",
    nameAZ: "Name A-Z",
    ranking: "Ranking",
    myData: "My Data",
    cleanUp: "Clean Up",
    import: "Import",
    export: "Export",
    backup: "Backup",
    restore: "Restore",
    clearAllTags: "Clear All Tags",
    deleteAll: "Delete All",
    saveTab: "Save tab",
    add: "Add",
    tags: "Tags",
    createNewTag: "Create new tag",
    newShort: "+ New",
    tagNamePlaceholder: "tag-name",
    all: "All",
    notTagged: "Not Tagged",
    notReachable: "Not Reachable",
    cleanUpComplete: "Clean Up complete",
    duplicatesRemoved: "Duplicates Removed",
    missingDescriptions: "Missing Descriptions",
    everythingLooksClean:
      "Everything looks clean — no duplicates, missing descriptions, or unreachable bookmarks found.",
    done: "Done",
  },
  es: {
    themeSwitchTooltip: "Cambiar tema de color ({theme})",
    collapseTabsTooltip: "Contraer pestañas a marcadores",
    expandSelectedTooltip: "Expandir enlaces de la etiqueta seleccionada",
    searchPlaceholder: "Buscar… o #etiqueta",
    tileView: "Vista de mosaicos",
    tableView: "Vista de tabla",
    previewView: "Vista previa",
    groupByDate: "Agrupar por fecha",
    sortOrder: "Ordenar por",
    dateAdded: "Fecha agregada",
    nameAZ: "Nombre A-Z",
    ranking: "Ranking",
    myData: "Mis datos",
    cleanUp: "Limpiar",
    import: "Importar",
    export: "Exportar",
    backup: "Respaldo",
    restore: "Restaurar",
    clearAllTags: "Limpiar todas las etiquetas",
    deleteAll: "Eliminar todo",
    saveTab: "Guardar pestaña",
    add: "Agregar",
    tags: "Etiquetas",
    createNewTag: "Crear nueva etiqueta",
    newShort: "+ Nuevo",
    tagNamePlaceholder: "nombre-etiqueta",
    all: "Todo",
    notTagged: "Sin etiqueta",
    notReachable: "No accesible",
    cleanUpComplete: "Limpieza completada",
    duplicatesRemoved: "Duplicados eliminados",
    missingDescriptions: "Descripciones faltantes",
    everythingLooksClean:
      "Todo está limpio: no se encontraron duplicados, descripciones faltantes ni marcadores inaccesibles.",
    done: "Listo",
  },
} as const;

type MessageKey = keyof typeof messages.en;
type Params = Record<string, string | number>;

function detectLocale(): LocaleCode {
  const extensionLocale =
    typeof chrome !== "undefined" && chrome?.i18n?.getUILanguage
      ? chrome.i18n.getUILanguage()
      : "";
  const runtimeLocale =
    extensionLocale ||
    (typeof navigator !== "undefined" ? navigator.language : "") ||
    "en";
  const normalized = runtimeLocale.toLowerCase();
  if (normalized.startsWith("es")) return "es";
  return "en";
}

const activeLocale = detectLocale();

export function t(key: MessageKey, params?: Params): string {
  const template = messages[activeLocale][key] ?? messages.en[key] ?? key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, name: string) => {
    const value = params[name];
    return value === undefined ? "" : String(value);
  });
}

