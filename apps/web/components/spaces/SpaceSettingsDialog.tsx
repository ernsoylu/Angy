"use client";

import { useState } from "react";
import Link from "next/link";
import { Cpu, Lock, Settings, X } from "lucide-react";
import type { PermLevelDto, SpaceDto, SpaceMemberDto } from "@angy/shared";
import { useEscape } from "../../lib/useEscape";
import { Avatar } from "../ui/Avatar";
import { Button } from "../ui/Button";
import { Callout } from "../ui/Callout";
import { IconButton } from "../ui/IconButton";
import { Tag } from "../ui/Tag";
import share from "../share/share.module.css";
import styles from "./space-settings.module.css";

const LEVEL_LABEL: Record<PermLevelDto, string> = {
  VIEW: "Can view",
  EDIT: "Can edit",
  FULL: "Full access",
  ADMIN: "Admin",
};

/**
 * Everything the space rail used to hold — who is in the space, what they can
 * do, and the way through to the full settings screen — reached from one
 * Settings button beside New page (frame 13).
 *
 * Read-only by design. Editing membership already has a home on the settings
 * screen, and that screen is ADMIN-gated as a whole; this dialog is visible to
 * anyone who can see the space, so giving it role dropdowns would either show
 * controls that fail on submit or split the same rules across two surfaces.
 * "All settings" is the seam between the two.
 */
export function SpaceSettingsDialog({
  space,
  members,
  onClose,
}: {
  space: SpaceDto;
  members: SpaceMemberDto[];
  onClose: () => void;
}) {
  useEscape(onClose);

  return (
    <div
      className={share.overlay}
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={share.dialog} role="dialog" aria-label="Space settings">
        <header className={share.header}>
          <div>
            <h2 className={share.title}>Space settings</h2>
            <div className={share.rowMeta}>
              {space.name} · {members.length} member{members.length === 1 ? "" : "s"}
            </div>
          </div>
          <IconButton label="Close" onClick={onClose}>
            <X size={15} />
          </IconButton>
        </header>

        <div className="t-caption">Space baseline</div>
        <div className={share.row}>
          <span className={share.spaceIcon}>
            <Cpu size={15} />
          </span>
          <span className={share.rowText}>
            <span className={share.rowName}>Everyone in {space.name}</span>
            <span className={share.rowMeta}>
              {members.length} member{members.length === 1 ? "" : "s"} · space baseline
            </span>
          </span>
          <span className={share.rowLevel}>
            {LEVEL_LABEL[space.defaultPermLevel]}
            <Lock size={13} />
          </span>
        </div>

        <div className="t-caption">Members</div>
        <div className={styles.memberList}>
          {members.map((member) => (
            <div key={member.userId} className={styles.memberRow}>
              <Avatar name={member.displayName} size={30} />
              <span style={{ minWidth: 0 }}>
                <span className={styles.memberName}>{member.displayName}</span>
                <span className={styles.memberEmail}>{member.email}</span>
              </span>
              <Tag hue={member.permLevel === "ADMIN" ? "amber" : "accent"}>
                {LEVEL_LABEL[member.permLevel]}
              </Tag>
            </div>
          ))}
        </div>

        <Callout tone="hardRule">
          Page grants can only widen this baseline, never reduce it. Membership changes apply
          immediately, everywhere.
        </Callout>

        <footer className={share.footer}>
          <span className={share.footerNote}>
            Everything else — identity, visibility, tags, danger zone — lives in full settings.
          </span>
          <Link href={`/s/${space.key}/settings`}>
            <Button variant="secondary" icon={<Settings size={14} />}>
              All settings
            </Button>
          </Link>
          <Button onClick={onClose}>Done</Button>
        </footer>
      </div>
    </div>
  );
}

/** The button itself, so the space header can stay a server component. */
export function SpaceSettingsButton({
  space,
  members,
}: {
  space: SpaceDto;
  members: SpaceMemberDto[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" icon={<Settings size={14} />} onClick={() => setOpen(true)}>
        Settings
      </Button>
      {open && (
        <SpaceSettingsDialog space={space} members={members} onClose={() => setOpen(false)} />
      )}
    </>
  );
}
