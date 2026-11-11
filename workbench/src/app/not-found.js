import WorkbenchError from '../components/WorkbenchError';

const error = {status: 404, message: '找不到這個頁面，請確認工作台網址。'};

export default function NotFound() {
  return <WorkbenchError error={error} />;
}
