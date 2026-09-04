'use client'

import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { Nav } from '@/components/Nav'
import { MailboxInspector } from '@/components/MailboxInspector'

export default function AccountMailboxPage() {
  const params = useParams()
  const search = useSearchParams()
  const router = useRouter()
  const migrationId = params.id as string
  const accountId = params.accountId as string
  const tab = search.get('tab') === 'browse' ? 'browse' : 'compare'

  return (
    <div className="flex min-h-screen">
      <Nav />
      <main className="flex-1 p-8 overflow-auto">
        <div className="max-w-6xl mx-auto">
          <button
            onClick={() => router.push(`/migrations/${migrationId}`)}
            className="text-xs text-gray-500 hover:text-gray-300 mb-4"
          >
            ← Back to migration
          </button>
          <MailboxInspector
            variant="page"
            mode="stored"
            migrationId={migrationId}
            accountId={accountId}
            defaultTab={tab}
          />
        </div>
      </main>
    </div>
  )
}
