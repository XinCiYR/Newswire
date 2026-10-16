// Keep the indexed expression identical to the PostgreSQL search predicate.
export function articleSearchVector(alias = '') {
  const prefix = alias ? `${alias}.` : '';
  return `to_tsvector('english'::regconfig, coalesce(${prefix}title, '') || ' ' || coalesce(${prefix}summary, ''))`;
}
