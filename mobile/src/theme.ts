/**
 * Hearth — the "family journal" look (Hearth.html). Warm paper, ink, one
 * terracotta accent; Newsreader for content, IBM Plex Sans for UI chrome.
 */
export const theme = {
  colors: {
    bg: '#F5F0E8',
    paper: '#FBF8F2',
    ink: '#26221C',
    inkDeep: '#211D18',
    text: '#26221C',
    textSoft: '#5C5548',
    textMuted: '#7C7468',
    textFaint: '#9A9284',
    kicker: '#A89E8C',
    hairline: '#E3DCCF',
    border: '#DED6C7',
    borderStrong: '#D6CDBC',
    checkOff: '#CFC5B2',
    handle: '#DDD4C3',
    disabled: '#C0B4A2',
    accent: '#9C4A2F',
    accentDeep: '#7E3A24',
    accentSoft: '#D8A78F',
    onDark: '#F5F0E8',
    onDarkMuted: '#C9BEA9',
    green: '#566B3F',
    amber: '#9A6B1E',
    teal: '#3E5C63',
    red: '#A9432F',
    scrim: 'rgba(33,29,24,0.32)',
    // confidence dots
    high: '#566B3F',
    medium: '#9A6B1E',
    low: '#B7AE9D',
  },
  font: {
    serif: 'Newsreader_500Medium',
    serifItalic: 'Newsreader_400Regular_Italic',
    sans: 'IBMPlexSans_400Regular',
    sansMedium: 'IBMPlexSans_500Medium',
    sansBold: 'IBMPlexSans_600SemiBold',
    sansHeavy: 'IBMPlexSans_700Bold',
  },
  radius: { sm: 9, md: 11, lg: 13, sheet: 22, pill: 999 },
  gutter: 30,
};

/** Family-member avatar colours, in the order new people are added. */
export const MEMBER_COLORS = ['#9C4A2F', '#3E5C63', '#5B6B45', '#6A5A73', '#7C6A3E', '#8A4A57'];
