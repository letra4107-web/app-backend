import { ImageSourcePropType } from 'react-native';
import { ACHIEVEMENTS } from '../services/achievementService';

export const DEFAULT_STUDENT_AVATARS = [
  { key: 'default:reader', label: 'Reader', image: require('../../assets/students/characters/student-hero-character.png') },
  { key: 'default:book', label: 'Book', image: require('../../assets/students/mascot/owl-mascot.png') },
  { key: 'default:star', label: 'Star', image: require('../../assets/students/illustrations/lesson-card-illustration.png') },
  { key: 'default:trophy', label: 'Trophy', image: require('../../assets/students/illustrations/achievement-illustration.png') },
] as const;

export const STUDENT_MODULE_AVATARS: Record<number, ImageSourcePropType> = {
  1: require('../../assets/students/aralin/aralin-header-books.png'),
  2: require('../../assets/students/aralin/aralin-phonics-blocks.png'),
  3: require('../../assets/students/aralin/aralin-current.png'),
  4: require('../../assets/students/aralin/aralin-reading-book.png'),
  5: require('../../assets/students/aralin/aralin-pencil-stars.png'),
  6: require('../../assets/students/mascot/owl-mascot.png'),
  7: require('../../assets/students/aralin/aralin-module-path.png'),
  8: require('../../assets/students/aralin/aralin-header-books.png'),
  9: require('../../assets/students/aralin/aralin-phonics-blocks.png'),
  10: require('../../assets/students/aralin/aralin-current.png'),
  11: require('../../assets/students/aralin/aralin-reading-book.png'),
  12: require('../../assets/students/aralin/aralin-pencil-stars.png'),
  13: require('../../assets/students/mascot/owl-mascot.png'),
  14: require('../../assets/students/aralin/aralin-module-path.png'),
  15: require('../../assets/students/aralin/aralin-header-books.png'),
  16: require('../../assets/students/aralin/aralin-phonics-blocks.png'),
  17: require('../../assets/students/aralin/aralin-current.png'),
};

export const studentAvatarSource = (
  avatarKey?: string | null,
  avatarUrl?: string | null,
): ImageSourcePropType | null => {
  if (avatarKey?.startsWith('badge:')) {
    const badge = ACHIEVEMENTS.find((item) => item.id === avatarKey.slice('badge:'.length));
    if (badge) return badge.image;
  }
  if (avatarKey?.startsWith('module:')) {
    const moduleNumber = Number(avatarKey.slice('module:'.length));
    if (Number.isInteger(moduleNumber) && STUDENT_MODULE_AVATARS[moduleNumber]) {
      return STUDENT_MODULE_AVATARS[moduleNumber];
    }
  }
  const preset = DEFAULT_STUDENT_AVATARS.find((item) => item.key === avatarKey);
  if (preset) return preset.image;
  return avatarUrl ? { uri: avatarUrl } : null;
};
