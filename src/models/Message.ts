import mongoose, { Document, Schema } from 'mongoose';

export interface IReaction {
  userId: mongoose.Types.ObjectId;
  emoji: string;
  createdAt: Date;
}

export interface IMessage extends Document {
  senderId: mongoose.Types.ObjectId;
  receiverId: mongoose.Types.ObjectId;
  text: string;
  imageUrl?: string;
  isRead: boolean;
  readAt?: Date;
  status: 'sent' | 'delivered' | 'seen';
  replyToId?: mongoose.Types.ObjectId;
  reactions: IReaction[];
  deletedAt?: Date;
  deletedBy?: mongoose.Types.ObjectId;
  /** Optional reference to the original post ID if this message is a shared post */
  sharedPostId?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const ReactionSchema = new Schema<IReaction>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    emoji: { type: String, required: true },
  },
  { timestamps: true }
);

const MessageSchema = new Schema<IMessage>(
  {
    senderId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    receiverId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    text: { type: String, default: '' },
    imageUrl: { type: String },
    isRead: { type: Boolean, default: false },
    readAt: { type: Date },
    status: { type: String, enum: ['sent', 'delivered', 'seen'], default: 'sent' },
    replyToId: { type: Schema.Types.ObjectId, ref: 'Message' },
    reactions: [ReactionSchema],
    deletedAt: { type: Date },
    deletedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    sharedPostId: { type: Schema.Types.ObjectId, ref: 'Post' },
  },
  { timestamps: true }
);

// Indexes for performance optimization
MessageSchema.index({ senderId: 1, receiverId: 1, createdAt: -1 }); // Compound index for conversation history
MessageSchema.index({ receiverId: 1, isRead: 1 }); // For unread message queries
MessageSchema.index({ createdAt: -1 }); // For recent messages
MessageSchema.index({ replyToId: 1 }); // For finding replies to a message

export const Message = mongoose.model<IMessage>('Message', MessageSchema);
