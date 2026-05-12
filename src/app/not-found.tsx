'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { checkIsTauri, isMobileDevice } from '@/lib/check';
import { Store } from '@tauri-apps/plugin-store';
import { WebRuntimeNotice } from '@/components/web-runtime-notice';

export default function NotFound() {
  const router = useRouter();
  const [countdown, setCountdown] = useState(5);
  const isTauri = checkIsTauri()

  async function clearRouteStore() {
    if (!isTauri) {
      return
    }

    const store = await Store.load('store.json');
    await store.delete('lastSettingPage')
    await store.delete('lastRecordPage')
  }

  useEffect(() => {
    clearRouteStore()
  }, [])

  useEffect(() => {
    if (!isTauri) {
      return
    }

    const timer = setTimeout(() => {
      router.push(isMobileDevice() ? '/mobile/chat' : '/core/main');
    }, 5000);

    // Update countdown timer every second
    const countdownInterval = setInterval(() => {
      setCountdown((prevCount) => {
        if (prevCount <= 1) {
          clearInterval(countdownInterval);
          return 0;
        }
        return prevCount - 1;
      });
    }, 1000);

    // Cleanup on component unmount
    return () => {
      clearTimeout(timer);
      clearInterval(countdownInterval);
    };
  }, [isTauri, router]);

  if (!isTauri) {
    return <WebRuntimeNotice />
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4">
      <h1 className="text-3xl font-bold mb-4">404 - Page Not Found</h1>
      <div className="text-center">
        <p className="mb-6">Redirecting to the {isMobileDevice() ? 'Chat' : 'Record'} page in {countdown} seconds...</p>
        <Button onClick={() => router.push(isMobileDevice() ? '/mobile/chat' : '/core/main')}>Go to {isMobileDevice() ? 'Chat' : 'Record'} Page Now</Button>
      </div>
    </div>
  );
}
