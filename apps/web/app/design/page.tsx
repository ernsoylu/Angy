import { Plus, Trash2, Upload } from "lucide-react";
import { AppShell } from "../../components/shell/AppShell";
import { Avatar, AvatarStack } from "../../components/ui/Avatar";
import { Badge, StatusDot } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Callout } from "../../components/ui/Callout";
import { Banner, Progress, Skeleton, Toast } from "../../components/ui/Feedback";
import { IconButton } from "../../components/ui/IconButton";
import { Input } from "../../components/ui/Input";
import { Kbd } from "../../components/ui/Kbd";
import { SearchField } from "../../components/ui/SearchField";
import { Select } from "../../components/ui/Select";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  RestrictedState,
} from "../../components/ui/SystemState";
import { Chip, Tag } from "../../components/ui/Tag";
import ui from "../../components/ui/ui.module.css";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section
      className={ui.card}
      style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }}
    >
      <h2 style={{ fontSize: 15, fontWeight: 600 }}>{title}</h2>
      {children}
    </section>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>{children}</div>;
}

const mockTree = [
  { id: "1", title: "Architecture", href: "#", children: [
    { id: "2", title: "Realtime Sync", href: "#", children: [] },
  ]},
  { id: "3", title: "Runbooks", href: "#", children: [] },
];

/** Visual QA gallery for the Phase 1 design system — compare against screenshots/A–C. */
export default function DesignPage() {
  return (
    <AppShell
      user={{ name: "Eren Soylu", email: "eren@acme.io" }}
      space={{ id: "1", key: "eng", name: "Engineering" }}
      tree={mockTree}
    >
      <div
        style={{
          padding: 32,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))",
          gap: 20,
          maxWidth: 1400,
        }}
      >
        <Section title="Type scale">
          <div className="t-title">Realtime Sync</div>
          <div className="t-h2">Section heading</div>
          <div className="t-body">Body prose reads here</div>
          <div className="t-ui">Interface label</div>
          <div className="t-caption">Section caption</div>
          <div className="t-code">encodeStateAsUpdate()</div>
        </Section>

        <Section title="Buttons">
          <Row>
            <Button>Save</Button>
            <Button variant="secondary">Cancel</Button>
            <Button variant="ghost">Dismiss</Button>
            <Button variant="danger" icon={<Trash2 size={14} />}>
              Delete
            </Button>
          </Row>
          <Row>
            <Button disabled>Save</Button>
            <Button icon={<Plus size={14} />}>New page</Button>
            <Button variant="secondary" icon={<Upload size={14} />}>
              Upload
            </Button>
            <IconButton label="Bold">
              <b>B</b>
            </IconButton>
            <IconButton label="Bold" active>
              <b>B</b>
            </IconButton>
          </Row>
        </Section>

        <Section title="Inputs">
          <Input placeholder="Page title..." />
          <Input defaultValue="" error="Give the page a title before publishing." />
          <Input placeholder="Locked field" disabled />
          <SearchField placeholder="Search Engineering..." />
          <Row>
            <Select defaultValue="edit">
              <option value="full">Full access</option>
              <option value="edit">Can edit</option>
              <option value="view">Can view</option>
            </Select>
            <Kbd>⌘K</Kbd>
            <Kbd>⌘S</Kbd>
            <Kbd>Esc</Kbd>
          </Row>
        </Section>

        <Section title="Chips, tags & badges">
          <Row>
            <Chip selected>All results</Chip>
            <Chip>Pages</Chip>
            <Chip>Video</Chip>
          </Row>
          <Row>
            <Tag hue="accent">architecture</Tag>
            <Tag hue="lilac">crdt</Tag>
            <Tag hue="sage">security</Tag>
            <Tag hue="amber">runbook</Tag>
            <Tag hue="clay">deprecated</Tag>
          </Row>
          <Row>
            <Badge hue="accent">Owner</Badge>
            <Badge hue="accent">Inherited</Badge>
            <Badge hue="sage">current</Badge>
            <Badge hue="neutral">12</Badge>
          </Row>
          <Row>
            <StatusDot status="live">Live</StatusDot>
            <StatusDot status="syncing">Syncing</StatusDot>
            <StatusDot status="offline">Offline</StatusDot>
          </Row>
        </Section>

        <Section title="Avatars">
          <Row>
            <Avatar name="Mira Kalvo" size={18} />
            <Avatar name="Mira Kalvo" size={22} />
            <Avatar name="Mira Kalvo" size={26} />
            <Avatar name="Mira Kalvo" size={30} />
          </Row>
          <Row>
            <Avatar name="Mira Kalvo" />
            <Avatar name="Rana Terzi" />
            <Avatar name="Jonas Dahl" />
            <Avatar name="Ada Lund" />
            <Avatar name="Eren Soylu" />
          </Row>
          <AvatarStack>
            <Avatar name="Mira Kalvo" size={22} />
            <Avatar name="Rana Terzi" size={22} />
            <Avatar name="Jonas Dahl" size={22} />
          </AvatarStack>
        </Section>

        <Section title="Callouts">
          <Callout tone="note" title="Note">
            Readers are served pre-rendered HTML.
          </Callout>
          <Callout tone="added" title="Added">
            Revisions are full-state blobs in S3.
          </Callout>
          <Callout tone="hardRule" title="Hard rule">
            Never store Yjs blobs in Postgres.
          </Callout>
          <Callout tone="removed" title="Removed">
            gc:false is not permitted on page docs.
          </Callout>
        </Section>

        <Section title="Banner & toasts">
          <Banner>Live editing — anyone with view access sees these changes within seconds.</Banner>
          <Toast tone="success" title="Page restored">
            v46 re-applied as v48.
          </Toast>
          <Toast tone="error" title="Upload failed">
            permission-bitmap.png exceeded 25 MB.
          </Toast>
        </Section>

        <Section title="Skeleton & progress">
          <Skeleton width="42%" />
          <Skeleton width="100%" height={18} />
          <Skeleton width="68%" />
          <Row>
            <span style={{ width: 70, fontSize: 13, color: "var(--text-2)" }}>Storage</span>
            <Progress value={14} hue="sage" />
            <span style={{ fontSize: 12.5, color: "var(--text-3)" }}>14%</span>
          </Row>
          <Row>
            <span style={{ width: 70, fontSize: 13, color: "var(--text-2)" }}>Indexing</span>
            <Progress value={62} hue="accent" />
            <span style={{ fontSize: 12.5, color: "var(--text-3)" }}>62%</span>
          </Row>
          <Row>
            <span style={{ width: 70, fontSize: 13, color: "var(--text-2)" }}>Quota</span>
            <Progress value={88} hue="clay" />
            <span style={{ fontSize: 12.5, color: "var(--text-3)" }}>88%</span>
          </Row>
        </Section>

        <Section title="Table">
          <table className={ui.table}>
            <thead>
              <tr>
                <th>Page</th>
                <th>Space</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Realtime Sync</td>
                <td>Engineering</td>
              </tr>
              <tr>
                <td>Storage Model</td>
                <td>Engineering</td>
              </tr>
              <tr>
                <td>Permissions</td>
                <td>Product</td>
              </tr>
            </tbody>
          </table>
        </Section>

        <Section title="System state · loading">
          <LoadingState />
        </Section>
        <Section title="System state · empty">
          {/* The gallery has nowhere to navigate to, so the action is a link
              back to the workspace rather than an inert button — the component
              no longer renders one without a destination. */}
          <EmptyState action={<Button href="/">Create the first page</Button>} />
        </Section>
        <Section title="System state · restricted">
          <RestrictedState />
        </Section>
        <Section title="System state · error">
          <ErrorState />
        </Section>
      </div>
    </AppShell>
  );
}
