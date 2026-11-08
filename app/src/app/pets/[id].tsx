import { Stack, useLocalSearchParams } from 'expo-router';
import { PetPassport } from '@/components/pet-passport';
import { Screen } from '@/components/ui';

export default function PetDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <Screen>
      <Stack.Screen options={{ title: 'Pet profile' }} />
      <PetPassport key={id} id={id} />
    </Screen>
  );
}
