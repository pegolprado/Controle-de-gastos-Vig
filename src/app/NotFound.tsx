import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { EmptyState } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

export default function NotFound() {
  return (
    <EmptyState
      icon={<Compass className="size-6" />}
      title="Página não encontrada"
      description="O endereço pode ter mudado ou você não tem acesso a ele."
      action={
        <Link to="/">
          <Button variant="primary">Ir para o painel</Button>
        </Link>
      }
    />
  );
}
