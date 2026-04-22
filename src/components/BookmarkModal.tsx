import { useState, useRef, useEffect, useCallback } from "react";
import type { Bookmark } from "../data/mockBookmarks";
import { tagColor } from "../utils/tagColors";
import { isSystemTag, visibleTags } from "../constants/tags";

interface Props {
  initial?: Bookmark | null;
  prefill?: { url: string; title: string; favicon: string; description?: string };
  existingTags: string[];
  onSave: (data: Omit<Bookmark, "id" | "addedAt">) => void;
  onClose: () => void;
}

export default function BookmarkModal({ initial, prefill, existingTags, onSave, onClose }: Props) {
  const systemTags = initial?.tags.filter(isSystemTag) ?? [];
  const [title, setTitle] = useState(initial?.title ?? prefill?.title ?? "");
  const [url, setUrl] = useState(initial?.url ?? prefill?.url ?? "");
  const [favicon, setFavicon] = useState(initial?.favicon ?? prefill?.favicon ?? "");
  const [description, setDescription] = useState(initial?.description ?? prefill?.description ?? "");
  const [tags, setTags] = useState<string[]>(visibleTags(initial?.tags ?? []));
  const [ranking, setRanking] = useState<number>(initial?.ranking ?? 0);
  const [tagInput, setTagInput] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const tagInputRef = useRef<HTMLInputElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  const suggestions = existingTags.filter(
    (t) =>
      t.toLowerCase().includes(tagInput.toLowerCase()) &&
      !tags.includes(t) &&
      tagInput.length > 0
  );

  const addTag = useCallback(
    (tag: string) => {
      const trimmed = tag.trim().toLowerCase().replace(/\s+/g, "-");
      if (trimmed && !tags.includes(trimmed)) {
        setTags((prev) => [...prev, trimmed]);
      }
      setTagInput("");
      setShowSuggestions(false);
    },
    [tags]
  );

  const removeTag = (tag: string) => setTags((prev) => prev.filter((t) => t !== tag));

  const handleTagKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      if (tagInput.trim()) addTag(tagInput);
    } else if (e.key === "Backspace" && !tagInput && tags.length) {
      removeTag(tags[tags.length - 1]);
    } else if (e.key === "Escape") {
      setShowSuggestions(false);
    }
  };

  // Auto-derive favicon from URL using Google's reliable favicon service
  const handleUrlBlur = () => {
    if (url) {
      try {
        const { hostname } = new URL(url.startsWith("http") ? url : `https://${url}`);
        setFavicon(`https://www.google.com/s2/favicons?domain=${hostname}&sz=32`);
      } catch {
        // Ignore invalid URL while user is typing.
      }
    }
  };

  const validate = () => {
    const e: Record<string, string> = {};
    if (!title.trim()) e.title = "Title is required";
    if (!url.trim()) {
      e.url = "URL is required";
    } else {
      try {
        new URL(url.startsWith("http") ? url : `https://${url}`);
      } catch {
        e.url = "Enter a valid URL";
      }
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSave = () => {
    if (!validate()) return;
    const normalized = url.startsWith("http") ? url : `https://${url}`;
    onSave({
      title: title.trim(),
      url: normalized,
      favicon,
      description: description.trim() || undefined,
      tags: [...tags, ...systemTags],
      ranking: ranking || undefined,
    });
  };

  // Close on backdrop click
  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === overlayRef.current) onClose();
  };

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
    >
      <div
        style={{
          background: "var(--card)",
          border: "1px solid var(--border-hover)",
          borderRadius: 14,
          padding: 24,
          width: 480,
          maxWidth: "calc(100vw - 40px)",
          display: "flex",
          flexDirection: "column",
          gap: 16,
          boxShadow: "0 24px 60px rgba(0,0,0,0.6)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", margin: 0 }}>
            {initial ? "Edit bookmark" : "Add bookmark"}
          </h2>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              color: "var(--text-3)",
              fontSize: 18,
              cursor: "pointer",
              lineHeight: 1,
              padding: 2,
            }}
          >
            ✕
          </button>
        </div>

        {/* Title */}
        <Field label="Title" error={errors.title}>
          <input
            autoFocus
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="My bookmark"
            style={inputStyle(!!errors.title)}
          />
        </Field>

        {/* URL */}
        <Field label="URL" error={errors.url}>
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onBlur={handleUrlBlur}
            placeholder="https://example.com"
            style={inputStyle(!!errors.url)}
          />
        </Field>

        {/* Description */}
        <Field label="Description" hint="optional">
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What's this page about?"
            style={inputStyle(false)}
          />
        </Field>

        {/* Tags */}
        <Field label="Tags" hint="press Enter or , to add">
          <div style={{ position: "relative" }}>
            {/* Tag pill input */}
            <div
              onClick={() => tagInputRef.current?.focus()}
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 6,
                padding: "7px 10px",
                background: "var(--bg)",
                border: "1px solid var(--border-hover)",
                borderRadius: 8,
                cursor: "text",
                minHeight: 40,
                alignItems: "center",
              }}
            >
              {tags.map((tag) => (
                <span
                  key={tag}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    fontSize: 12,
                    padding: "2px 8px",
                    borderRadius: 99,
                    background: tagColor(tag) + "22",
                    color: tagColor(tag),
                    border: `1px solid ${tagColor(tag)}44`,
                    userSelect: "none",
                  }}
                >
                  {tag}
                  <span
                    onClick={() => removeTag(tag)}
                    style={{ cursor: "pointer", opacity: 0.7, fontSize: 10, lineHeight: 1 }}
                  >
                    ✕
                  </span>
                </span>
              ))}
              <input
                ref={tagInputRef}
                type="text"
                value={tagInput}
                onChange={(e) => {
                  setTagInput(e.target.value);
                  setShowSuggestions(true);
                }}
                onKeyDown={handleTagKeyDown}
                onFocus={() => setShowSuggestions(true)}
                onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                placeholder={tags.length === 0 ? "dev, design, work…" : ""}
                style={{
                  background: "none",
                  border: "none",
                  outline: "none",
                  color: "var(--text)",
                  fontSize: 13,
                  flex: 1,
                  minWidth: 80,
                }}
              />
            </div>

            {/* Autocomplete suggestions */}
            {showSuggestions && suggestions.length > 0 && (
              <div
                style={{
                  position: "absolute",
                  top: "calc(100% + 4px)",
                  left: 0,
                  right: 0,
                  background: "var(--border)",
                  border: "1px solid var(--border-hover)",
                  borderRadius: 8,
                  overflow: "hidden",
                  zIndex: 10,
                  boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
                }}
              >
                {suggestions.map((s) => (
                  <button
                    key={s}
                    onMouseDown={() => addTag(s)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      width: "100%",
                      padding: "8px 12px",
                      background: "none",
                      border: "none",
                      color: "var(--text)",
                      fontSize: 13,
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                    onMouseEnter={(e) =>
                      ((e.currentTarget as HTMLElement).style.background = "var(--border-hover)")
                    }
                    onMouseLeave={(e) =>
                      ((e.currentTarget as HTMLElement).style.background = "none")
                    }
                  >
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        background: tagColor(s),
                        flexShrink: 0,
                      }}
                    />
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        </Field>

        {/* Ranking */}
        <Field label="Ranking" hint="higher number = sorted first">
          <input
            type="number"
            min={0}
            step={1}
            value={ranking}
            onChange={(e) => setRanking(Math.max(0, Math.floor(Number(e.target.value))))}
            style={inputStyle(false)}
          />
        </Field>

        {/* Actions */}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
          <button onClick={onClose} style={secondaryBtn}>
            Cancel
          </button>
          <button onClick={handleSave} style={primaryBtn}>
            {initial ? "Save changes" : "Add bookmark"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text-2)" }}>{label}</label>
        {hint && <span style={{ fontSize: 11, color: "var(--text-3)" }}>{hint}</span>}
        {error && <span style={{ fontSize: 11, color: "#ef4444", marginLeft: "auto" }}>{error}</span>}
      </div>
      {children}
    </div>
  );
}

function inputStyle(hasError: boolean): React.CSSProperties {
  return {
    background: "var(--bg)",
    border: `1px solid ${hasError ? "#ef4444" : "var(--border-hover)"}`,
    borderRadius: 8,
    padding: "8px 10px",
    color: "var(--text)",
    fontSize: 13,
    outline: "none",
    width: "100%",
  };
}

const primaryBtn: React.CSSProperties = {
  background: "#3b82f6",
  border: "none",
  borderRadius: 8,
  padding: "8px 18px",
  color: "#fff",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};

const secondaryBtn: React.CSSProperties = {
  background: "var(--border)",
  border: "1px solid var(--border-hover)",
  borderRadius: 8,
  padding: "8px 16px",
  color: "var(--text-2)",
  fontSize: 13,
  cursor: "pointer",
};
