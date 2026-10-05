"use client";

import { useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import Image from "next/image";
import ChevronIcon from "@/components/ChevronIcon";
import JournalPhotoStrip from "./JournalPhotoStrip";
import MomentSheet from "./MomentSheet";
import type { useJournalPhotoUpload } from "./useJournalPhotoUpload";
import { createJournalSection, updateJournalSection, reorderJournalSections, deleteJournalSection } from "@/app/(public)/my-world/journal/actions";
import {
  JOURNAL_SECTION_TYPES,
  JOURNAL_SECTION_TYPE_LABELS,
  JOURNAL_PHOTO_CAPTION_MAX,
  JOURNAL_SECTION_TITLE_MAX,
  JOURNAL_SECTION_NOTES_MAX,
  isJournalSectionType,
  type JournalEntrySectionRow,
  type JournalSectionType,
} from "@/lib/journal-sections";

type PhotoState = ReturnType<typeof useJournalPhotoUpload>;

type Sheet =
  | { kind: "note"; localId: string }
  | { kind: "move"; localId: string }
  | { kind: "addSection" }
  | { kind: "assign"; sectionId: string }
  | { kind: "deleteSection"; sectionId: string };

function typeLabel(type: string): string {
  return isJournalSectionType(type) ? JOURNAL_SECTION_TYPE_LABELS[type] : JOURNAL_SECTION_TYPE_LABELS.other;
}

/** Moments V2 — Stage 2, "Photos". The simple path stays simple: Add
 * Photos → they appear → Continue. Field QA UX Pass 1 — organizing is
 * still optional but no longer hidden: once a photo is saved, a clear
 * "Organize Your Photos" area offers + Add Section (and points to photo
 * notes); once a section exists, that area becomes the section manager. Built entirely on the
 * existing photo pipeline (useJournalPhotoUpload / JournalPhotoStrip) and
 * the photo-section foundation actions; the cover stays explicit and
 * independent of order and sections. */
export default function MomentPhotosStage({
  photos,
  sections,
  setSections,
  ensureEntryId,
  onError,
}: {
  photos: PhotoState;
  sections: JournalEntrySectionRow[];
  setSections: Dispatch<SetStateAction<JournalEntrySectionRow[]>>;
  ensureEntryId: () => Promise<string | null>;
  onError: (message: string | null) => void;
}) {
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [busy, setBusy] = useState(false);

  const { items } = photos;
  const grouped = sections.length > 0;
  const sectionIds = new Set(sections.map((s) => s.id));
  const groupOf = (sectionId: string | null | undefined) => (sectionId && sectionIds.has(sectionId) ? sectionId : null);
  const unsectioned = items.filter((it) => groupOf(it.sectionId) === null);
  const savedCount = items.filter((it) => it.status === "complete").length;
  // The Moment's ONE cover across every group: the explicit cover, else
  // the first photo in display order (sections in order, then the rest).
  const displayOrder = [...sections.flatMap((s) => items.filter((it) => groupOf(it.sectionId) === s.id)), ...unsectioned];
  const coverLocalId = (items.find((it) => it.isCover) ?? displayOrder[0])?.localId ?? null;

  const stripHandlers = {
    error: null,
    batchProgress: null,
    disabled: photos.hasActiveUploads,
    onRemove: photos.handleRemove,
    onRetry: photos.retryItem,
    onDragReorder: photos.handleDragReorder,
    onMoveEarlier: photos.moveEarlier,
    onMoveLater: photos.moveLater,
    onMakeCover: photos.makeCover,
    onEditNote: (localId: string) => setSheet({ kind: "note", localId }),
  };

  async function addSection(type: JournalSectionType) {
    setBusy(true);
    onError(null);
    const entryId = await ensureEntryId();
    const result = entryId ? await createJournalSection(entryId, { sectionType: type }) : { error: "Couldn't start this Moment." };
    setBusy(false);
    if ("error" in result) {
      onError(result.error);
      setSheet(null);
      return;
    }
    setSections((prev) => [...prev, result.section]);
    const hasLoose = items.some((it) => it.status === "complete" && groupOf(it.sectionId) === null);
    setSheet(hasLoose ? { kind: "assign", sectionId: result.section.id } : null);
  }

  async function patchSection(sectionId: string, patch: { sectionType?: string; title?: string | null; notes?: string | null }) {
    const entryId = await ensureEntryId();
    if (!entryId) return;
    const result = await updateJournalSection(entryId, sectionId, patch);
    if ("error" in result) {
      onError(result.error);
      return;
    }
    setSections((prev) => prev.map((s) => (s.id === sectionId ? result.section : s)));
  }

  async function moveSection(sectionId: string, direction: -1 | 1) {
    const index = sections.findIndex((s) => s.id === sectionId);
    const target = index + direction;
    if (index === -1 || target < 0 || target >= sections.length) return;
    const next = [...sections];
    [next[index], next[target]] = [next[target], next[index]];
    setSections(next);
    const entryId = await ensureEntryId();
    if (!entryId) return;
    const result = await reorderJournalSections(entryId, next.map((s) => s.id));
    if ("error" in result) {
      setSections(sections);
      onError(result.error);
    }
  }

  async function removeSection(sectionId: string) {
    setBusy(true);
    const entryId = await ensureEntryId();
    const result = entryId ? await deleteJournalSection(entryId, sectionId) : { error: "Couldn't delete that section." };
    setBusy(false);
    setSheet(null);
    if ("error" in result) {
      onError(result.error);
      return;
    }
    setSections((prev) => prev.filter((s) => s.id !== sectionId));
    photos.releaseSection(sectionId);
  }

  const noteItem = sheet?.kind === "note" ? items.find((it) => it.localId === sheet.localId) : null;
  const moveItem = sheet?.kind === "move" ? items.find((it) => it.localId === sheet.localId) : null;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="font-display text-base font-bold tracking-tight text-ink">Photos</h2>
        <p className="text-sm text-ink/55">Add as many as you like.</p>
      </div>

      {!grouped ? (
        <JournalPhotoStrip
          items={items}
          {...stripHandlers}
          error={photos.error}
          batchProgress={photos.batchProgress}
          batchPerf={photos.batchPerf}
          onDismissBatchPerf={photos.dismissBatchPerf}
          onFilesSelected={(files) => void photos.handleFiles(files)}
        />
      ) : (
        <>
          {photos.batchProgress && (
            <p className="text-xs font-semibold text-ink/50">
              {photos.batchProgress.completed === 0 ? "Preparing…" : `Uploading ${photos.batchProgress.completed} of ${photos.batchProgress.total}`}
            </p>
          )}
          {photos.error && <p className="text-xs text-red-600">{photos.error}</p>}
          <div>
            <h3 className="font-display text-base font-bold tracking-tight text-ink">Organize Your Photos</h3>
            <p className="text-sm text-ink/55">Tap &bull;&bull;&bull; on a photo to move it to a section or add a note.</p>
          </div>
          {sections.map((section, index) => (
            <SectionBlock
              key={section.id}
              section={section}
              isFirst={index === 0}
              isLast={index === sections.length - 1}
              onChangeType={(type) => void patchSection(section.id, { sectionType: type })}
              onSaveTitle={(title) => void patchSection(section.id, { title })}
              onSaveNotes={(notes) => void patchSection(section.id, { notes })}
              onMove={(direction) => void moveSection(section.id, direction)}
              onDelete={() => setSheet({ kind: "deleteSection", sectionId: section.id })}
              onAddPhotos={() => setSheet({ kind: "assign", sectionId: section.id })}
            >
              <JournalPhotoStrip
                items={items.filter((it) => groupOf(it.sectionId) === section.id)}
                {...stripHandlers}
                coverLocalId={coverLocalId}
                compactEmpty
                onMoveToSection={(localId) => setSheet({ kind: "move", localId })}
                onRemoveFromSection={(localId) => photos.assignSection([localId], null)}
                onFilesSelected={(files) => void photos.handleFiles(files, { sectionId: section.id })}
              />
            </SectionBlock>
          ))}

          <div className="flex flex-col gap-2 rounded-2xl border border-black/10 bg-white p-3">
            <div>
              <h3 className="text-sm font-bold text-ink">More Photos</h3>
              {unsectioned.length === 0 && <p className="text-xs text-ink/45">Photos not in a section appear here.</p>}
            </div>
            <JournalPhotoStrip
              items={unsectioned}
              {...stripHandlers}
              coverLocalId={coverLocalId}
              compactEmpty
              onMoveToSection={(localId) => setSheet({ kind: "move", localId })}
              onFilesSelected={(files) => void photos.handleFiles(files)}
            />
          </div>
        </>
      )}

      {grouped && (
        <button
          type="button"
          onClick={() => setSheet({ kind: "addSection" })}
          disabled={busy}
          className="flex h-11 items-center justify-center rounded-2xl border border-findmi/40 bg-white text-sm font-semibold text-findmi-700 transition hover:bg-findmi-50 disabled:opacity-60"
        >
          + Add Section
        </button>
      )}
      {!grouped && savedCount > 0 && (
        <section aria-label="Organize Your Photos" className="flex flex-col gap-3 rounded-2xl border border-findmi/25 bg-findmi-50/50 p-4">
          <div>
            <h3 className="font-display text-base font-bold tracking-tight text-ink">Organize Your Photos</h3>
            <p className="mt-0.5 text-sm text-ink/60">Group photos into parts of your experience, like the place, the food or the people. Optional.</p>
            <p className="mt-1.5 text-xs text-ink/50">Tip: tap &bull;&bull;&bull; on any photo to add a note.</p>
          </div>
          <button
            type="button"
            onClick={() => setSheet({ kind: "addSection" })}
            disabled={busy}
            className="flex h-11 items-center justify-center rounded-2xl border border-findmi/40 bg-white text-sm font-semibold text-findmi-700 transition hover:bg-findmi-50 disabled:opacity-60"
          >
            + Add Section
          </button>
        </section>
      )}

      {noteItem && <NoteSheet item={noteItem} onClose={() => setSheet(null)} onSave={(text) => photos.saveCaption(noteItem.localId, text)} />}

      {moveItem && (
        <MomentSheet title="Move To Section" onClose={() => setSheet(null)}>
          <div className="flex flex-col gap-1.5 pb-2">
            {sections.map((s) => (
              <SheetOption
                key={s.id}
                label={s.title?.trim() || typeLabel(s.section_type)}
                active={groupOf(moveItem.sectionId) === s.id}
                onClick={() => {
                  photos.assignSection([moveItem.localId], s.id);
                  setSheet(null);
                }}
              />
            ))}
            <SheetOption
              label="No Section"
              hint="Shown under More Photos"
              active={groupOf(moveItem.sectionId) === null}
              onClick={() => {
                photos.assignSection([moveItem.localId], null);
                setSheet(null);
              }}
            />
          </div>
        </MomentSheet>
      )}

      {sheet?.kind === "addSection" && (
        <MomentSheet title="Add Section" description="Pick what this part of the story is about. You can rename it." onClose={() => setSheet(null)}>
          <div className="grid grid-cols-2 gap-2 pb-2">
            {JOURNAL_SECTION_TYPES.map((type) => (
              <button
                key={type}
                type="button"
                disabled={busy}
                onClick={() => void addSection(type)}
                className="flex h-12 items-center justify-center rounded-xl border border-black/10 bg-white px-2 text-sm font-semibold text-ink transition hover:border-findmi/50 hover:bg-findmi-50 disabled:opacity-60"
              >
                {JOURNAL_SECTION_TYPE_LABELS[type]}
              </button>
            ))}
          </div>
        </MomentSheet>
      )}

      {sheet?.kind === "assign" && (
        <AssignSheet
          section={sections.find((s) => s.id === sheet.sectionId) ?? null}
          candidates={items.filter((it) => it.status === "complete" && groupOf(it.sectionId) === null)}
          onClose={() => setSheet(null)}
          onAssign={(localIds) => {
            photos.assignSection(localIds, sheet.sectionId);
            setSheet(null);
          }}
          onUpload={(files) => {
            void photos.handleFiles(files, { sectionId: sheet.sectionId });
            setSheet(null);
          }}
        />
      )}

      {sheet?.kind === "deleteSection" && (
        <MomentSheet
          title="Delete This Section?"
          description="Its photos will stay in your Moment."
          onClose={() => setSheet(null)}
          footer={
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => void removeSection(sheet.sectionId)}
                className="flex h-12 items-center justify-center rounded-2xl bg-red-600 text-sm font-bold text-white transition hover:bg-red-700 disabled:opacity-60"
              >
                {busy ? "Deleting…" : "Delete Section"}
              </button>
              <button type="button" onClick={() => setSheet(null)} className="flex h-11 items-center justify-center text-sm font-semibold text-ink/60 hover:text-ink">
                Cancel
              </button>
            </>
          }
        />
      )}
    </div>
  );
}

function SectionBlock({
  section,
  isFirst,
  isLast,
  onChangeType,
  onSaveTitle,
  onSaveNotes,
  onMove,
  onDelete,
  onAddPhotos,
  children,
}: {
  section: JournalEntrySectionRow;
  isFirst: boolean;
  isLast: boolean;
  onChangeType: (type: string) => void;
  onSaveTitle: (title: string | null) => void;
  onSaveNotes: (notes: string | null) => void;
  onMove: (direction: -1 | 1) => void;
  onDelete: () => void;
  onAddPhotos: () => void;
  children: ReactNode;
}) {
  const [title, setTitle] = useState(section.title ?? "");
  const [notes, setNotes] = useState(section.notes ?? "");
  const [notesOpen, setNotesOpen] = useState(Boolean(section.notes));
  const label = typeLabel(section.section_type);

  return (
    <div className="flex flex-col gap-2.5 rounded-2xl border border-black/10 bg-white p-3">
      <div className="flex items-center gap-1.5">
        <select
          value={isJournalSectionType(section.section_type) ? section.section_type : "other"}
          onChange={(e) => onChangeType(e.target.value)}
          aria-label="Section type"
          className="h-8 min-w-0 flex-1 truncate rounded-full border border-black/10 bg-findmi-50/60 px-3 text-xs font-semibold text-findmi-700 focus:border-findmi/50 focus:outline-none"
        >
          {JOURNAL_SECTION_TYPES.map((type) => (
            <option key={type} value={type}>
              {JOURNAL_SECTION_TYPE_LABELS[type]}
            </option>
          ))}
        </select>
        <IconButton label="Move section up" disabled={isFirst} onClick={() => onMove(-1)}>
          <ChevronIcon direction="up" className="h-4 w-4" />
        </IconButton>
        <IconButton label="Move section down" disabled={isLast} onClick={() => onMove(1)}>
          <ChevronIcon direction="down" className="h-4 w-4" />
        </IconButton>
        <button type="button" onClick={onDelete} className="h-8 shrink-0 rounded-full px-2.5 text-xs font-semibold text-red-600/80 transition hover:bg-red-50 hover:text-red-700">
          Delete
        </button>
      </div>

      <input
        type="text"
        value={title}
        maxLength={JOURNAL_SECTION_TITLE_MAX}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => {
          const next = title.trim() || null;
          if (next !== (section.title ?? null)) onSaveTitle(next);
        }}
        placeholder={label}
        aria-label="Section title"
        className="h-10 w-full rounded-xl border border-transparent bg-transparent px-1 font-display text-base font-bold tracking-tight text-ink placeholder:text-ink/35 focus:border-black/10 focus:bg-white focus:outline-none"
      />

      {notesOpen ? (
        <textarea
          value={notes}
          maxLength={JOURNAL_SECTION_NOTES_MAX}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => {
            const next = notes.trim() || null;
            if (next !== (section.notes ?? null)) onSaveNotes(next);
            if (!next) setNotesOpen(false);
          }}
          rows={2}
          placeholder="Add a note about this section"
          className="rounded-xl border border-black/10 bg-white px-3 py-2 text-sm text-ink placeholder:text-ink/40 focus:border-findmi/50 focus:outline-none"
        />
      ) : (
        <button type="button" onClick={() => setNotesOpen(true)} className="w-fit text-xs font-semibold text-ink/50 transition hover:text-findmi-700">
          Add A Note About This Section
        </button>
      )}

      {children}

      <button type="button" onClick={onAddPhotos} className="w-fit text-xs font-semibold text-findmi-700 transition hover:text-findmi-800">
        Add Photos To This Section
      </button>
    </div>
  );
}

function IconButton({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink/55 transition hover:bg-black/5 hover:text-ink disabled:opacity-30"
    >
      {children}
    </button>
  );
}

function SheetOption({ label, hint, active, onClick }: { label: string; hint?: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center justify-between gap-2 rounded-xl border px-3.5 py-3 text-left transition ${active ? "border-findmi bg-findmi-50" : "border-black/10 bg-white hover:border-findmi/40"}`}
    >
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold text-ink">{label}</span>
        {hint && <span className="block text-xs text-ink/50">{hint}</span>}
      </span>
      {active && <span className="shrink-0 text-xs font-semibold text-findmi-700">Current</span>}
    </button>
  );
}

function NoteSheet({
  item,
  onClose,
  onSave,
}: {
  item: PhotoState["items"][number];
  onClose: () => void;
  onSave: (text: string) => Promise<{ ok: true } | { error: string }>;
}) {
  const [text, setText] = useState(item.caption ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(value: string) {
    setSaving(true);
    setError(null);
    const result = await onSave(value);
    setSaving(false);
    if ("error" in result) setError(result.error);
    else onClose();
  }

  return (
    <MomentSheet
      title={item.caption ? "Edit Note" : "Add A Note"}
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            disabled={saving}
            onClick={() => void save(text)}
            className="flex h-12 items-center justify-center rounded-2xl bg-findmi text-sm font-bold text-white transition hover:bg-findmi-600 disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save Note"}
          </button>
          {item.caption && (
            <button type="button" disabled={saving} onClick={() => void save("")} className="flex h-11 items-center justify-center text-sm font-semibold text-red-600/80 hover:text-red-700">
              Remove Note
            </button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-3 pb-2">
        <div className="relative mx-auto aspect-square w-40 overflow-hidden rounded-2xl bg-mist">
          <Image src={item.previewUrl} alt="" fill unoptimized sizes="160px" className="object-cover" />
        </div>
        <textarea
          value={text}
          maxLength={JOURNAL_PHOTO_CAPTION_MAX}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          autoFocus
          placeholder="What's happening in this photo?"
          className="rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-sm text-ink placeholder:text-ink/40 focus:border-findmi/50 focus:outline-none"
        />
        <p className="text-right text-[11px] text-ink/40">
          {text.length}/{JOURNAL_PHOTO_CAPTION_MAX}
        </p>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
    </MomentSheet>
  );
}

function AssignSheet({
  section,
  candidates,
  onClose,
  onAssign,
  onUpload,
}: {
  section: JournalEntrySectionRow | null;
  candidates: PhotoState["items"];
  onClose: () => void;
  onAssign: (localIds: string[]) => void;
  onUpload: (files: FileList) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const fileRef = useRef<HTMLInputElement>(null);
  const name = section ? section.title?.trim() || typeLabel(section.section_type) : "This Section";

  return (
    <MomentSheet
      title={`Add Photos To ${name}`}
      description={candidates.length > 0 ? "Choose photos that aren't in a section yet, or upload new ones." : "Upload new photos straight into this section."}
      onClose={onClose}
      footer={
        <>
          {candidates.length > 0 && (
            <button
              type="button"
              disabled={selected.size === 0}
              onClick={() => onAssign(candidates.filter((c) => selected.has(c.localId)).map((c) => c.localId))}
              className="flex h-12 items-center justify-center rounded-2xl bg-findmi text-sm font-bold text-white transition hover:bg-findmi-600 disabled:opacity-50"
            >
              {selected.size === 0 ? "Select Photos" : `Add ${selected.size} Photo${selected.size === 1 ? "" : "s"}`}
            </button>
          )}
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="flex h-11 items-center justify-center rounded-2xl border border-black/10 text-sm font-semibold text-ink/70 transition hover:border-findmi/40 hover:text-findmi-700"
          >
            Upload New Photos
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            className="sr-only"
            aria-label="Upload photos to this section"
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) onUpload(e.target.files);
              e.target.value = "";
            }}
          />
        </>
      }
    >
      {candidates.length > 0 && (
        <div className="grid grid-cols-3 gap-2 pb-2">
          {candidates.map((c) => {
            const on = selected.has(c.localId);
            return (
              <button
                key={c.localId}
                type="button"
                aria-pressed={on}
                aria-label={on ? "Selected photo" : "Select photo"}
                onClick={() =>
                  setSelected((prev) => {
                    const next = new Set(prev);
                    if (next.has(c.localId)) next.delete(c.localId);
                    else next.add(c.localId);
                    return next;
                  })
                }
                className={`relative aspect-square overflow-hidden rounded-xl border-2 transition ${on ? "border-findmi" : "border-transparent"}`}
              >
                <Image src={c.previewUrl} alt="" fill unoptimized sizes="120px" className="object-cover" />
                <span
                  className={`absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full border-2 text-xs font-bold ${
                    on ? "border-findmi bg-findmi text-white" : "border-white bg-black/30 text-transparent"
                  }`}
                >
                  ✓
                </span>
              </button>
            );
          })}
        </div>
      )}
    </MomentSheet>
  );
}
