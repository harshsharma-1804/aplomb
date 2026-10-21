import { Search, RefreshCw } from "lucide-react";
export function CollectionHead({count,noun,query,onQuery,onRefresh}:{count:number;noun:string;query:string;onQuery:(value:string)=>void;onRefresh:()=>void}) {
  return <div className="ui-card__head"><h2 className="ui-card__title ui-row"><span className="ui-count">{count}</span>{noun}</h2><div className="ui-row"><div className="ui-search" style={{width:240}}><Search/><input className="ui-input ui-input--sm" aria-label={`Filter ${noun}`} placeholder={`Filter ${noun}`} value={query} onChange={e=>onQuery(e.target.value)}/></div><button className="ui-iconbtn ui-iconbtn--bordered" aria-label={`Refresh ${noun}`} onClick={onRefresh}><RefreshCw/></button></div></div>;
}
