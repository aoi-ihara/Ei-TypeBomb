-- Public rooms are opt-in; existing and new rooms default to private.
ALTER TABLE public.ei_typebomb_rooms
    ADD COLUMN IF NOT EXISTS is_public boolean DEFAULT false;
