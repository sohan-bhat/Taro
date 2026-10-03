/**
 * @deprecated There are no spinners. A pending action changes its label to a verb ("Saving") and
 * sets `disabled` and `aria-busy`. This renders nothing; delete it once nothing imports it.
 */
export function Spinner(_props: { className?: string }) {
  return null;
}
