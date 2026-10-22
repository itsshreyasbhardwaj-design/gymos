'use client';

import { useState, useTransition } from 'react';
import { Heart, ThumbsDown } from 'lucide-react';
import { Button } from '@/components/ui';
import {
  toggleFavouriteExerciseAction,
  toggleDislikedExerciseAction,
} from '@/app/(app)/actions';

export function ExercisePreferenceButtons({
  exerciseId,
  isFavourite,
  isDisliked,
}: {
  exerciseId: string;
  isFavourite: boolean;
  isDisliked: boolean;
}) {
  const [favourite, setFavourite] = useState(isFavourite);
  const [disliked, setDisliked] = useState(isDisliked);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex gap-2">
      <Button
        variant={favourite ? 'primary' : 'secondary'}
        size="sm"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setFavourite((v) => !v);
            if (disliked) setDisliked(false);
            await toggleFavouriteExerciseAction(exerciseId);
          })
        }
      >
        <Heart className="h-4 w-4" aria-hidden="true" />
        {favourite ? 'Favourite' : 'Add favourite'}
      </Button>
      <Button
        variant={disliked ? 'danger' : 'secondary'}
        size="sm"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setDisliked((v) => !v);
            if (favourite) setFavourite(false);
            await toggleDislikedExerciseAction(exerciseId);
          })
        }
      >
        <ThumbsDown className="h-4 w-4" aria-hidden="true" />
        {disliked ? 'Avoided' : 'Avoid'}
      </Button>
    </div>
  );
}
