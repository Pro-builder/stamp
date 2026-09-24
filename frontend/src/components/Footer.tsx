import { CONTRACT_ID, explorerAddress } from '@/lib/stamp';

function Footer() {
  return (
    <footer className="muted mx-auto w-full max-w-[680px] px-4 pb-12 pt-16 text-sm">
      <p>
        Messages and replies are stored onchain, so anyone can read them.{' '}
        {CONTRACT_ID && (
          <a className="link" href={explorerAddress(CONTRACT_ID)} target="_blank" rel="noreferrer">
            View the contract
          </a>
        )}
        {' · '}
        <a className="link" href="https://github.com/Pro-builder/stamp" target="_blank" rel="noreferrer">
          Source
        </a>
        {' · '}
        Built with{' '}
        <a className="link" href="https://scaffoldstacks.mintlify.app/" target="_blank" rel="noreferrer">
          Scaffold Stacks
        </a>
      </p>
    </footer>
  );
}

export default Footer;
