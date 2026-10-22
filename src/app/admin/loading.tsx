import { PageLoading } from "@/components/ui/PageLoading";

// Shown inside the admin shell the instant a link is followed, while the page
// fetches. See PageLoading for why this file has to exist at all.
export default function AdminLoading() {
  return <PageLoading />;
}
