import { scaffoldConfig } from '../scaffold.config';

function NetworkBadge() {
  return <span className="muted text-sm">on Stacks {scaffoldConfig.network}</span>;
}

export default NetworkBadge;
