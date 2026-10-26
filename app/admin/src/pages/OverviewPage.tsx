import { Overview } from '../Overview'
import { usePanel } from '../ui/Shell'

// Task 5 replaces this with the health strip, headline numbers and latest activity.
export function OverviewPage() {
  const { session, network, showTest } = usePanel()
  return <Overview session={session} network={network} showTest={showTest} />
}
