import {
  configure,
  interrupted,
  resumeInterrupted,
  start,
  submit,
  verify,
  verifyCollecting,
  OtpError,
  type PendingOtp,
} from '@otp.com/sdk-react-native';
import React, {useState} from 'react';
import {
  Button,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

/**
 * A menu in front of the bridge, so each call can be made on a device.
 *
 * Nothing here is part of the package. It is the app a customer would write, and it uses only what a
 * customer can see.
 */
export default function App() {
  const [publishableKey, setPublishableKey] = useState('otp_pk_test_…');
  const [recipient, setRecipient] = useState('+14155552671');
  const [code, setCode] = useState('');
  const [pending, setPending] = useState<PendingOtp | null>(null);
  const [outcome, setOutcome] = useState('');

  const report = async (label: string, call: () => Promise<unknown>) => {
    setOutcome(`${label}…`);
    try {
      setOutcome(`${label}: ${JSON.stringify(await call(), null, 2)}`);
    } catch (error) {
      // Every call in the package rejects with this and nothing else, which is what makes a screen
      // like this able to branch rather than guess.
      if (error instanceof OtpError) {
        setOutcome(
          `${label} failed: ${error.kind}` +
            `${error.type ? ` (${error.type})` : ''}` +
            `${error.retryAfterSeconds ? `, retry after ${error.retryAfterSeconds}s` : ''}` +
            `\n${error.message}`,
        );
        return;
      }
      setOutcome(`${label} failed with something unexpected: ${String(error)}`);
    }
  };

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>otp.com bridge</Text>

        <Text style={styles.label}>publishable key</Text>
        <TextInput
          style={styles.input}
          value={publishableKey}
          onChangeText={setPublishableKey}
          autoCapitalize="none"
        />

        <Text style={styles.label}>recipient</Text>
        <TextInput style={styles.input} value={recipient} onChangeText={setRecipient} autoCapitalize="none" />

        <Button
          title="configure"
          onPress={() => report('configure', () => configure({publishableKey}))}
        />

        <View style={styles.section}>
          <Text style={styles.heading}>Presented screens</Text>
          <Button title="verify" onPress={() => report('verify', () => verify(recipient, 'en'))} />
          <Button
            title="verify, collecting a phone number"
            onPress={() => report('verifyCollecting', () => verifyCollecting('phone', 'en'))}
          />
          <Button
            title="verify, collecting an email address"
            onPress={() => report('verifyCollecting', () => verifyCollecting('email', 'en'))}
          />
          <Button
            title="resume an interrupted verification"
            onPress={() => report('resumeInterrupted', () => resumeInterrupted())}
          />
        </View>

        <View style={styles.section}>
          <Text style={styles.heading}>Your own screen</Text>
          <Button
            title="start"
            onPress={() =>
              report('start', async () => {
                const started = await start(recipient, 'en');
                setPending(started);
                return started;
              })
            }
          />
          <Text style={styles.label}>code{pending ? ` (${pending.codeLength} digits)` : ''}</Text>
          <TextInput style={styles.input} value={code} onChangeText={setCode} keyboardType="number-pad" />
          <Button
            title="submit"
            onPress={() => report('submit', () => submit(pending?.id ?? '', code))}
          />
          <Button
            title="what is in flight"
            onPress={() => report('interrupted', () => interrupted())}
          />
        </View>

        <Text style={styles.outcome}>{outcome}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {flex: 1},
  content: {padding: 20, gap: 8},
  title: {fontSize: 22, fontWeight: '600', marginBottom: 8},
  heading: {fontSize: 16, fontWeight: '600', marginBottom: 4},
  section: {marginTop: 16, gap: 8},
  label: {fontSize: 12, opacity: 0.6},
  input: {borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 10},
  outcome: {marginTop: 20, fontFamily: 'Menlo', fontSize: 12},
});
