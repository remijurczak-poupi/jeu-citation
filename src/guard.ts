// While a game is running, leaving through the menu asks first.
import { useEffect } from 'react';

let active = false;
export const leaveGuarded = () => active;
export function useLeaveGuard(on: boolean) {
  useEffect(() => { active = on; return () => { active = false; }; }, [on]);
}
