interface SeekerList {
  title: string;
  filters: { qualification_status?: string; farhan_fit?: string; min_score?: number; collapse_twins?: boolean };
}

export const seekerLists: Record<string, SeekerList> = {
  all: { title: 'Everything else', filters: { qualification_status: 'NEEDS_REVIEW', collapse_twins: true } },
  best: { title: 'Best matches', filters: { qualification_status: 'READY' } },   // the Worker reads READY as READY + READY_HIGH; keeps the stored-copy path
  worth: { title: 'Worth a try', filters: { qualification_status: 'STRETCH_READY' } },
  good: { title: 'More good matches', filters: { qualification_status: 'NEEDS_REVIEW', min_score: 60, collapse_twins: true } },
};
