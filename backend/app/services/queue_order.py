from app.models.ticket import Ticket


def waiting_order():
    """Returned tickets first, then FIFO; UUID breaks equal timestamp ties."""
    return (Ticket.called_at.is_(None), Ticket.called_at, Ticket.created_at, Ticket.id)
