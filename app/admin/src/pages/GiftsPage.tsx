import { Gifts } from '../Gifts'
import { usePanel } from '../ui/Shell'

// Task 5 replaces this with the history scan's figures and status.
export function GiftsPage() {
  const { session, network, showTest } = usePanel()
  return <Gifts session={session} network={network} showTest={showTest} />
}
