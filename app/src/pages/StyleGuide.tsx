import { type ReactNode, useEffect, useRef, useState } from 'react'
import type { Address } from 'viem'
import {
  AddressChip,
  AmountInput,
  Badge,
  Banner,
  Button,
  ButtonLink,
  Card,
  Dialog,
  EmptyState,
  Field,
  PageHeader,
  Panel,
  Stat,
  StatusBox,
  TabPanel,
  Tabs,
} from '../components/ui'
import './StyleGuide.css'

// A development-only page (App.tsx serves it only when import.meta.env.DEV is true) that shows every token and
// every shared component in each state, with the longest values the app allows.

const COLOURS = [
  'bg',
  'surface',
  'surface-raised',
  'text',
  'text-muted',
  'border',
  'line',
  'action',
  'action-ink',
  'attention',
  'attention-bg',
  'danger',
  'danger-ink',
  'success-bg',
  'focus',
]
const TYPE = ['xs', 'sm', 'md', 'lg', 'xl', '2xl']
const SPACE = [1, 2, 3, 4, 5, 6, 7, 8, 9]
const RADIUS = ['sm', 'md', 'lg', 'pill']

// The longest values: a 50-character username, a 100-character Fundit title and a seven-figure amount.
const LONG_USERNAME = 'averyveryverylongusernamethatkeepsgoingandgoing_50'
const LONG_TITLE = "Clean water for every family in the valley's villages, and a new school roof before the rainy season"
const LONG_AMOUNT = '1,234,567.89 USDC'
const ADDRESS: Address = '0x1234567890abcdef1234567890abcdef12345678'

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="sg-section">
      <h2 className="sg-heading">{title}</h2>
      {children}
    </section>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="sg-row">
      <p className="sg-label">{label}</p>
      <div className="sg-items">{children}</div>
    </div>
  )
}

export function StyleGuide() {
  const [tab, setTab] = useState('fundits')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [amount, setAmount] = useState('25')
  const focused = useRef<HTMLButtonElement>(null)

  // Shows the focus ring on one button, as a keyboard user would see it.
  useEffect(() => {
    focused.current?.focus()
  }, [])

  return (
    <div className="sg">
      <PageHeader title="Style guide" subtitle="Tokens and shared components. Development builds only." width="wide" />

      <Section title="Colour">
        <div className="sg-swatches">
          {COLOURS.map((c) => (
            <div key={c} className="sg-swatch">
              <span className="sg-swatch-chip" style={{ background: `var(--${c})` }} />
              <code>--{c}</code>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Type">
        <p className="sg-display">Display</p>
        {TYPE.map((t) => (
          <p key={t} className="sg-type" style={{ fontSize: `var(--text-${t})`, lineHeight: `var(--text-${t}-line)` }}>
            <code>--text-{t}</code> Give to the people you care about
          </p>
        ))}
        <p className="sg-type">
          <span className="sg-weight-regular">Regular 400</span> <span className="sg-weight-medium">Medium 500</span>{' '}
          <span className="sg-weight-bold">Bold 700</span>
        </p>
      </Section>

      <Section title="Spacing">
        {SPACE.map((n) => (
          <div key={n} className="sg-space">
            <code>--space-{n}</code>
            <span className="sg-space-bar" style={{ width: `var(--space-${n})` }} />
          </div>
        ))}
      </Section>

      <Section title="Radius and shadow">
        <div className="sg-items">
          {RADIUS.map((r) => (
            <div key={r} className="sg-radius" style={{ borderRadius: `var(--radius-${r})` }}>
              <code>--radius-{r}</code>
            </div>
          ))}
          <div className="sg-radius sg-shadow-1">
            <code>--shadow-1</code>
          </div>
          <div className="sg-radius sg-shadow-pop">
            <code>--shadow-pop</code>
          </div>
        </div>
      </Section>

      <Section title="Button">
        {(['primary', 'secondary', 'ghost', 'danger'] as const).map((v) => (
          <Row key={v} label={v}>
            <Button variant={v}>Default</Button>
            <Button variant={v} className="sg-hover">
              Hover
            </Button>
            <Button variant={v} disabled>
              Disabled
            </Button>
            <Button variant={v} loading>
              Sending...
            </Button>
            <Button variant={v} size="lg">
              Large
            </Button>
          </Row>
        ))}
        <Row label="focus">
          <Button ref={focused}>Focused</Button>
        </Row>
        <Row label="block and link">
          <Button block>Full width</Button>
          <ButtonLink to="/explore" variant="secondary">
            Explore Fundits
          </ButtonLink>
        </Row>
      </Section>

      <Section title="Card and Panel">
        <div className="sg-grid">
          <Card>
            <p className="sg-flat">A raised card.</p>
          </Card>
          <Card tone="muted">
            <p className="sg-flat">A muted card.</p>
          </Card>
          <Panel title="Add money" description="Send USDC to your Fundit account." onClose={() => {}}>
            <p className="sg-flat">Panel body.</p>
          </Panel>
          <Panel title={LONG_TITLE}>
            <p className="sg-flat">A panel with the longest title.</p>
          </Panel>
        </div>
      </Section>

      <Section title="Field">
        <div className="sg-grid">
          <Field id="sg-name" label="Your name" hint="Shown next to your gift.">
            <input defaultValue="Ada" />
          </Field>
          <Field id="sg-amount" label="Amount" hint="Up to 5,000 USDC">
            <AmountInput id="sg-amount" value={amount} onChange={(e) => setAmount(e.target.value)} currency="USDC" />
          </Field>
          <Field id="sg-amount-error" label="Amount" error="Enter an amount above 0.">
            <AmountInput id="sg-amount-error" value="0" onChange={() => {}} currency="USDC" />
          </Field>
          <Field id="sg-disabled" label="Disabled">
            <input defaultValue="Can't change this" disabled />
          </Field>
          <Field id="sg-select" label="Token">
            <select className="select" defaultValue="usdc">
              <option value="usdc">USDC</option>
              <option value="eurc">EURC</option>
            </select>
          </Field>
          <Field id="sg-message" label="Message" hint="Up to 280 bytes.">
            <textarea rows={3} defaultValue="Good luck with the roof!" />
          </Field>
        </div>
      </Section>

      <Section title="Tabs">
        <Tabs
          label="Style guide tabs"
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'fundits', label: 'Your Fundits' },
            { id: 'gifts', label: 'Your gifts' },
            { id: 'long', label: 'A much longer tab label that has to wrap' },
          ]}
        />
        <TabPanel id="fundits" active={tab === 'fundits'}>
          <p className="sg-flat">Your Fundits panel.</p>
        </TabPanel>
        <TabPanel id="gifts" active={tab === 'gifts'}>
          <p className="sg-flat">Your gifts panel.</p>
        </TabPanel>
        <TabPanel id="long" active={tab === 'long'}>
          <p className="sg-flat">The long label panel.</p>
        </TabPanel>
      </Section>

      <Section title="Stat">
        <div className="sg-grid">
          <Stat value="25.00 USDC" label="Your balance" />
          <Stat value="0.00 EURC" label="EURC" />
          <Stat value={LONG_AMOUNT} label="Raised" size="lg" />
          <Stat value={LONG_AMOUNT} label="Raised" />
        </div>
      </Section>

      <Section title="Badge, Banner and StatusBox">
        <Row label="badge">
          <Badge>Ended</Badge>
          <Badge tone="success">Goal reached</Badge>
          <Badge tone="attention">Ends soon</Badge>
        </Row>
        <Banner action={<Button variant="secondary">Learn more</Button>}>
          <p>Fundit runs on Arc. Gifts arrive in seconds.</p>
        </Banner>
        <Banner tone="attention" action={<Button>Save now</Button>}>
          <p>
            <strong>Save a recovery key so you never lose this account</strong>
          </p>
        </Banner>
        <StatusBox>
          <p>Sending your gift...</p>
        </StatusBox>
        <StatusBox tone="success">
          <p>Thank you. Your gift is on its way.</p>
        </StatusBox>
        <StatusBox tone="error">
          <p>You cancelled the request.</p>
        </StatusBox>
      </Section>

      <Section title="AddressChip">
        <Row label="default">
          <AddressChip address={ADDRESS} />
        </Row>
        <Row label="with explorer">
          <AddressChip address={ADDRESS} explorer />
        </Row>
        <Card>
          <div className="sg-account">
            <strong className="sg-username">{LONG_USERNAME}</strong>
            <AddressChip address={ADDRESS} explorer />
          </div>
        </Card>
      </Section>

      <Section title="EmptyState">
        <EmptyState action={<ButtonLink to="/create">Start a Fundit</ButtonLink>}>
          <p>You have not started a Fundit yet.</p>
        </EmptyState>
      </Section>

      <Section title="PageHeader">
        <PageHeader
          title={LONG_TITLE}
          subtitle={<p>by {LONG_USERNAME}</p>}
          actions={
            <>
              <Button variant="secondary">Share</Button>
              <Button>Give</Button>
            </>
          }
        />
      </Section>

      <Section title="Dialog">
        <Row label="open">
          <Button variant="secondary" onClick={() => setDialogOpen(true)}>
            Open the dialog
          </Button>
        </Row>
        <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} title="Sign in">
          <Field id="sg-dialog-username" label="Username">
            <input />
          </Field>
          <Button block>Sign in with a passkey</Button>
        </Dialog>
      </Section>
    </div>
  )
}
