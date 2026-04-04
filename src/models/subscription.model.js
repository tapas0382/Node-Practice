import mongoose, {Schema} from "mongoose";

const subscriptionSchema = new Schema({
    subscriber: {
        type: Schema.Types.ObjectId, //One who is subscribing
        ref: "USer"
    },
    channel: {
        type: Schema.Types.ObjectId, //One to whom subscriber is subscribing
        ref: "USer"
    }
}, {timestamps: true});





export const Subscription = mongoose.model("Subscription", subscriptionSchema);