import { useEffect, useState } from 'react';

const PHONE_QUERY = '(max-width: 767.98px)';

export default function useIsPhone() {
  const [isPhone, setIsPhone] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia(PHONE_QUERY).matches,
  );

  useEffect(() => {
    const media = window.matchMedia(PHONE_QUERY);
    const update = () => setIsPhone(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  return isPhone;
}
