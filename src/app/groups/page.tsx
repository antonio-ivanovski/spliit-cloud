import { RecentGroupList } from '@/app/groups/recent-group-list'
import { AuthenticatedGroupList } from '@/app/groups/authenticated-group-list'
import { auth } from '@/lib/auth'
import { Metadata } from 'next'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

export const metadata: Metadata = {
  title: 'Groups',
}

export default async function GroupsPage() {
  const session = await auth()

  if (!session?.user) {
    // Anonymous users only see device groups
    return <RecentGroupList />
  }

  // Authenticated users see both authenticated and device groups
  return (
    <Tabs defaultValue="authenticated" className="w-full">
      <TabsList className="grid w-full grid-cols-2">
        <TabsTrigger value="authenticated">Authenticated Groups</TabsTrigger>
        <TabsTrigger value="device">Device Groups</TabsTrigger>
      </TabsList>
      <TabsContent value="authenticated" className="mt-4">
        <Card>
          <CardHeader>
            <CardTitle>Authenticated Groups</CardTitle>
            <CardDescription>
              Synced across all your devices
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AuthenticatedGroupList />
          </CardContent>
        </Card>
      </TabsContent>
      <TabsContent value="device" className="mt-4">
        <Card>
          <CardHeader>
            <CardTitle>Device Groups</CardTitle>
            <CardDescription>
              Stored locally on this device only
            </CardDescription>
          </CardHeader>
          <CardContent>
            <RecentGroupList />
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  )
}
