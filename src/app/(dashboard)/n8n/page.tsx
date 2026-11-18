import { N8nWorkspace } from '@/components/n8n/n8n-workspace';

export const metadata = {
  title: 'n8n Automation Workspace | WhatsApp CRM',
  description: 'Enterprise WhatsApp workflow automation and orchestrations powered by n8n.',
};

export default function N8nPage() {
  return <N8nWorkspace />;
}
