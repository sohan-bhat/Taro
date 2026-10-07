import React, { useEffect, useState } from 'react';
import ForgeReconciler, { Button, ButtonGroup, Heading, SectionMessage, Spinner, Stack, Text, TextArea } from '@forge/react';
import { invoke } from '@forge/bridge';

const when = (iso) => (iso ? new Date(iso).toLocaleString() : '');

function App() {
  const [status, setStatus] = useState(null);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    invoke('status')
      .then(setStatus)
      .catch(() => setError("Couldn't load the connection. Reload the page."));
  }, []);

  const run = async (name) => {
    setBusy(true);
    setError('');
    try {
      const next = await invoke(name);
      setStatus({ hasKey: !!next.key || next.hasKey, createdAt: next.createdAt });
      setKey(next.key ?? '');
    } catch {
      setError("That didn't work. Try again.");
    } finally {
      setBusy(false);
    }
  };

  if (!status && !error) return <Spinner label="Loading" />;

  return (
    <Stack space="space.200">
      <Heading as="h2">Taro</Heading>
      <Text>
        Taro joins your meetings and files or updates Jira tickets when someone asks out loud. It acts as this app, never as
        a person. To connect, make a key here and paste it into Setup on Taro&apos;s dashboard, under Jira.
      </Text>
      {error && <SectionMessage appearance="error"><Text>{error}</Text></SectionMessage>}
      {key ? (
        <Stack space="space.100">
          <SectionMessage appearance="warning">
            <Text>Copy this key now and paste it into Taro. It won&apos;t be shown again. Anyone with it can act as this app.</Text>
          </SectionMessage>
          <TextArea value={key} isReadOnly isMonospaced resize="none" />
        </Stack>
      ) : status?.hasKey ? (
        <Text>A key was made {when(status.createdAt)}. Making a new one disconnects Taro until you paste the new key.</Text>
      ) : (
        <Text>No key yet.</Text>
      )}
      <ButtonGroup>
        <Button appearance="primary" isDisabled={busy} onClick={() => run('createKey')}>
          {status?.hasKey ? 'Make a new key' : 'Make a connection key'}
        </Button>
        {status?.hasKey && (
          <Button appearance="subtle" isDisabled={busy} onClick={() => run('removeKey')}>
            Disconnect Taro
          </Button>
        )}
      </ButtonGroup>
    </Stack>
  );
}

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
