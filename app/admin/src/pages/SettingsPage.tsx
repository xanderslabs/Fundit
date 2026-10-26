import { OwnerControls } from '../OwnerControls'
import { usePanel } from '../ui/Shell'

// Task 8 replaces this with current settings, controls and the danger zone.
export function SettingsPage() {
  const { session, network } = usePanel()
  return <OwnerControls session={session} network={network} />
}
